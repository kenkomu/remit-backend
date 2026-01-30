import { ethers } from 'ethers';
import { pool } from './database.js';
import fs from 'fs';

const BASE_RPC_URL = process.env.BASE_RPC_URL!;
const SIMPLE_ESCROW_ADDRESS = process.env.SIMPLE_ESCROW_ADDRESS!;
const ESCROW_ARTIFACT_PATH = new URL('../blockchain/SimpleEscrowUSDC.json', import.meta.url);
const SimpleEscrowUSDCAbi: { abi: any } = JSON.parse(
  fs.readFileSync(ESCROW_ARTIFACT_PATH, 'utf-8')
);

interface ContractEvent {
  eventName: string;
  txHash: string;
  blockNumber: number;
  logIndex: number;
  args: any[];
  data?: string;
  topics?: readonly string[];
}

export class ContractEventMonitor {
  private provider: ethers.JsonRpcProvider;
  private contract: ethers.Contract;
  private isMonitoring: boolean = false;

  constructor() {
    this.provider = new ethers.JsonRpcProvider(BASE_RPC_URL);
    this.contract = new ethers.Contract(
      SIMPLE_ESCROW_ADDRESS,
      SimpleEscrowUSDCAbi.abi,
      this.provider
    );
  }

  async startEventMonitoring(startBlock?: number) {
    if (this.isMonitoring) {
      console.log('🔍 Event monitoring already running');
      return;
    }

    this.isMonitoring = true;
    console.log('🚀 Starting contract event monitoring');

    // Get the latest processed block from database
    const latestBlock = startBlock || await this.getLatestProcessedBlock();
    console.log('📊 Starting from block:', latestBlock);

    // Setup event listeners for new blocks
    this.contract.on('EscrowCreated', (...args: any[]) => {
      this.handleEvent('EscrowCreated', args);
    });

    this.contract.on('PaymentConfirmed', (...args: any[]) => {
      this.handleEvent('PaymentConfirmed', args);
    });

    this.contract.on('EscrowRefunded', (...args: any[]) => {
      this.handleEvent('EscrowRefunded', args);
    });

    // Process historical events
    await this.processHistoricalEvents(latestBlock);

    console.log('✅ Event monitoring started');
  }

  async stopEventMonitoring() {
    this.isMonitoring = false;
    this.contract.removeAllListeners();
    console.log('🛑 Event monitoring stopped');
  }

  private async handleEvent(eventName: string, args: any[]) {
    console.log(`📝 Event received: ${eventName}`, args);

    try {
      const event = args[args.length - 1]; // Event object is last argument
      const eventData = {
        eventName,
        txHash: event.transactionHash,
        blockNumber: event.blockNumber,
        logIndex: event.logIndex,
        args: args.slice(0, -1), // Remove event object
      };

      await this.saveEventToDatabase(eventData);
      await this.updateRelatedRecords(eventData);
      
      console.log(`✅ Processed event: ${eventName}`, event.transactionHash);
    } catch (error) {
      console.error(`❌ Error processing event ${eventName}:`, error);
    }
  }

  private async saveEventToDatabase(event: ContractEvent) {
    const eventData = {
      event_name: event.eventName,
      contract_address: SIMPLE_ESCROW_ADDRESS,
      tx_hash: event.txHash,
      block_number: event.blockNumber,
      log_index: event.logIndex,
      event_data: JSON.stringify(this.formatEventData(event)),
      escrow_id_hash: this.extractEscrowIdHash(event),
      payment_id: this.extractPaymentId(event),
      sender_address: this.extractSenderAddress(event),
      beneficiary_address: this.extractBeneficiaryAddress(event),
      amount_usdc: this.extractAmount(event),
      block_timestamp: new Date(), // Will be updated with actual block time
    };

    await pool.query(
      `
      INSERT INTO contract_events (
        event_name, contract_address, tx_hash, block_number, log_index,
        event_data, escrow_id_hash, payment_id, sender_address,
        beneficiary_address, amount_usdc, block_timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (tx_hash, log_index) DO NOTHING
      `,
      Object.values(eventData)
    );
  }

  private async updateRelatedRecords(event: ContractEvent) {
    switch (event.eventName) {
      case 'EscrowCreated':
        await this.handleEscrowCreated(event);
        break;
      case 'PaymentConfirmed':
        await this.handlePaymentConfirmed(event);
        break;
      case 'EscrowRefunded':
        await this.handleEscrowRefunded(event);
        break;
    }
  }

  private async handleEscrowCreated(event: ContractEvent) {
    const [escrowId, sender, beneficiary, amount, expiry] = event.args;
    
    // Try to find the escrow in database by blockchain_escrow_id
    const { rows } = await pool.query(
      `
      UPDATE contract_events
      SET escrow_id = (
        SELECT escrow_id 
        FROM escrows 
        WHERE blockchain_escrow_id = $1
        LIMIT 1
      )
      WHERE tx_hash = $2 AND log_index = $3
      RETURNING escrow_id
      `,
      [
        Number(escrowId), // Use the blockchain escrow ID directly
        event.txHash,
        event.logIndex,
      ]
    );

    if (rows.length > 0) {
      console.log('🔗 Linked event to escrow:', rows[0].escrow_id);
    }
  }

  private async handlePaymentConfirmed(event: ContractEvent) {
    const [escrowId, paymentId, beneficiary, amount] = event.args;
    
    // Update transaction status to confirmed
    await pool.query(
      `
      UPDATE blockchain_transactions
      SET status = 'confirmed', confirmations = 1, confirmed_at = NOW()
      WHERE tx_hash = $1
      `,
      [event.txHash]
    );
  }

  private async handleEscrowRefunded(event: ContractEvent) {
    const [escrowId, sender] = event.args;
    
    // Update transaction status to confirmed
    await pool.query(
      `
      UPDATE blockchain_transactions
      SET status = 'confirmed', confirmations = 1, confirmed_at = NOW()
      WHERE tx_hash = $1
      `,
      [event.txHash]
    );
  }

  private async processHistoricalEvents(startBlock: number) {
    console.log('📚 Processing historical events from block', startBlock);

    const latestBlock = await this.provider.getBlockNumber();
    const batchSize = 1000; // Process in batches to avoid timeouts

    for (let fromBlock = startBlock; fromBlock <= latestBlock; fromBlock += batchSize) {
      const toBlock = Math.min(fromBlock + batchSize - 1, latestBlock);
      
      try {
        const events = await this.contract.queryFilter(
          this.contract.filters.EscrowCreated(),
          fromBlock,
          toBlock
        );

        const paymentEvents = await this.contract.queryFilter(
          this.contract.filters.PaymentConfirmed(),
          fromBlock,
          toBlock
        );

        const refundEvents = await this.contract.queryFilter(
          this.contract.filters.EscrowRefunded(),
          fromBlock,
          toBlock
        );

        const allEvents = [
          ...events.map(e => ({ eventName: 'EscrowCreated', ...e })),
          ...paymentEvents.map(e => ({ eventName: 'PaymentConfirmed', ...e })),
          ...refundEvents.map(e => ({ eventName: 'EscrowRefunded', ...e })),
        ];

        console.log(`📊 Processing ${allEvents.length} events from blocks ${fromBlock}-${toBlock}`);

        for (const event of allEvents) {
          await this.handleEvent(event.eventName, [...(event as any).args || [], event]);
        }

      } catch (error) {
        console.error(`❌ Error processing blocks ${fromBlock}-${toBlock}:`, error);
      }
    }

    console.log('✅ Historical event processing complete');
  }

  private async getLatestProcessedBlock(): Promise<number> {
    try {
      const { rows } = await pool.query(
        'SELECT MAX(block_number) as latest_block FROM contract_events'
      );
      
      return rows[0]?.latest_block ? Number(rows[0].latest_block) - 1 : 0;
    } catch (error) {
      console.error('Error getting latest processed block:', error);
      return 0;
    }
  }

  private formatEventData(event: ContractEvent): any {
    switch (event.eventName) {
      case 'EscrowCreated':
        return {
          escrowId: Number(event.args[0]),
          sender: event.args[1],
          beneficiary: event.args[2],
          amount: ethers.formatUnits(event.args[3], 6), // USDC has 6 decimals
          expiry: Number(event.args[4]),
        };
      case 'PaymentConfirmed':
        return {
          escrowId: Number(event.args[0]),
          paymentId: event.args[1],
          beneficiary: event.args[2],
          amount: ethers.formatUnits(event.args[3], 6), // USDC has 6 decimals
        };
      case 'EscrowRefunded':
        return {
          escrowId: Number(event.args[0]),
          sender: event.args[1],
        };
      default:
        return { args: event.args };
    }
  }

  private extractEscrowIdHash(event: ContractEvent): string | null {
    if (['EscrowCreated', 'PaymentConfirmed', 'EscrowRefunded'].includes(event.eventName)) {
      return Number(event.args[0]).toString();
    }
    return null;
  }

  private extractPaymentId(event: ContractEvent): string | null {
    if (event.eventName === 'PaymentConfirmed') {
      return event.args[1]; // paymentId is a string in USDC contract
    }
    return null;
  }

  private extractSenderAddress(event: ContractEvent): string | null {
    if (['EscrowCreated', 'EscrowRefunded'].includes(event.eventName)) {
      return event.args[1];
    }
    return null;
  }

  private extractBeneficiaryAddress(event: ContractEvent): string | null {
    if (event.eventName === 'EscrowCreated') {
      return event.args[2];
    }
    if (event.eventName === 'PaymentConfirmed') {
      return event.args[2]; // beneficiary in PaymentConfirmed event
    }
    return null;
  }

  private extractAmount(event: ContractEvent): string | null {
    if (event.eventName === 'EscrowCreated' || event.eventName === 'PaymentConfirmed') {
      return event.args[3]?.toString() || null; // amount is in position 3 for both events
    }
    return null;
  }

  // Health check method
  async getMonitoringStatus(): Promise<{
    isMonitoring: boolean;
    latestProcessedBlock: number;
    latestBlockNumber: number;
    eventsProcessed: number;
  }> {
    const latestProcessedBlock = await this.getLatestProcessedBlock();
    const latestBlockNumber = await this.provider.getBlockNumber();
    
    const { rows } = await pool.query(
      'SELECT COUNT(*) as count FROM contract_events'
    );

    return {
      isMonitoring: this.isMonitoring,
      latestProcessedBlock,
      latestBlockNumber,
      eventsProcessed: parseInt(rows[0].count),
    };
  }
}

// Singleton instance
export const contractEventMonitor = new ContractEventMonitor();

// Auto-start monitoring in production
if (process.env.NODE_ENV === 'production') {
  contractEventMonitor.startEventMonitoring().catch(console.error);
}

export default contractEventMonitor;

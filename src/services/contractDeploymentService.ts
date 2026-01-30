import { ethers } from 'ethers';
import fs from 'fs';

// Contract artifact - Use SimpleEscrowUSDC.sol
const USDC_ESCROW_ARTIFACT_PATH = new URL('../blockchain/SimpleEscrowUSDC.sol', import.meta.url);

// Environment variables
const BASE_RPC_URL = process.env.BASE_RPC_URL!;
const PRIVATE_KEY = process.env.BASE_PRIVATE_KEY!;
const BASE_USDC_CONTRACT = process.env.BASE_USDC_CONTRACT!;

interface DeployContractParams {
  backendServiceAddress: string;
  feeCollectorAddress: string;
  usdcTokenAddress?: string;
}

interface DeploymentResult {
  contractAddress: string;
  transactionHash: string;
  blockNumber: number;
  deployerAddress: string;
  constructorArgs: any[];
  gasUsed: string;
}

class ContractDeploymentService {
  private provider: ethers.JsonRpcProvider;
  private wallet: ethers.Wallet;

  constructor() {
    this.provider = new ethers.JsonRpcProvider(BASE_RPC_URL);
    this.wallet = new ethers.Wallet(PRIVATE_KEY, this.provider);
  }

  /**
   * Deploy SimpleEscrowUSDC contract with USDC token support
   */
  async deploySimpleEscrowUSDC({
    backendServiceAddress,
    feeCollectorAddress,
    usdcTokenAddress = BASE_USDC_CONTRACT,
  }: DeployContractParams): Promise<DeploymentResult> {
    console.log('🚀 Deploying SimpleEscrowUSDC contract...');
    console.log('Backend Service:', backendServiceAddress);
    console.log('Fee Collector:', feeCollectorAddress);
    console.log('USDC Token:', usdcTokenAddress);

    // Contract bytecode and ABI for SimpleEscrowUSDC
    const contractBytecode = "0x608060405234801561001057600080fd5b50604051611a38380380611a3883398181016040528101906100329190610296565b600073ffffffffffffffffffffffffffffffffffffffff168373ffffffffffffffffffffffffffffffffffffffff1603610101576040517f08c379a000000000000000000000000000000000000000000000000000000000815260040160f890610338565b600073ffffffffffffffffffffffffffffffffffffffff168273ffffffffffffffffffffffffffffffffffffffff1603610170576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401610167906103a4565b60405180910390fd5b600073ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff16036101df576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016101d690610410565b60405180910390fd5b33600060006101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff1602179055508260016000600101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff1602179055508160026000600101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff16021790555080600360006101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff160217905550606460048190555050505050610430565b600080fd5b600073ffffffffffffffffffffffffffffffffffffffff82169050919050565b60006103418261031c565b9050919050565b61035181610336565b811461035c57600080fd5b50565b60008151905061036e81610348565b92915050565b600080600060608486031215610393576103926102b7565b5b60006103a18682870161035f565b93505060206103b28682870161035f565b92505060406103c38682870161035f565b9150509250925092565b600082825260208201905092915050565b7f496e76616c6964206261636b656e642061646472657373000000000000000000600082015250565b60006104146017836103cd565b915061041f826103de565b602082019050919050565b6000602082019050818103600083015261044381610407565b9050919050565b7f496e76616c69642066656520636f6c6c6563746f72000000000000000000000600082015250565b60006104806015836103cd565b915061048b8261044a565b602082019050919050565b600060208201905081810360008301526104af81610473565b9050919050565b7f496e76616c6964205553444320616464726573730000000000000000000000600082015250565b60006104ec6014836103cd565b91506104f7826104b6565b602082019050919050565b6000602082019050818103600083015261051b816104df565b9050919050565b61161080610531600039";

    const contractAbi = [
      {
        "inputs": [
          {"internalType": "address", "name": "_backendService", "type": "address"},
          {"internalType": "address", "name": "_feeCollector", "type": "address"},
          {"internalType": "address", "name": "_usdc", "type": "address"}
        ],
        "stateMutability": "nonpayable",
        "type": "constructor"
      },
      {
        "anonymous": false,
        "inputs": [
          {"indexed": true, "internalType": "bytes32", "name": "escrowId", "type": "bytes32"},
          {"indexed": true, "internalType": "address", "name": "sender", "type": "address"},
          {"indexed": true, "internalType": "address", "name": "beneficiary", "type": "address"},
          {"indexed": false, "internalType": "uint256", "name": "amount", "type": "uint256"},
          {"indexed": false, "internalType": "string", "name": "purpose", "type": "string"},
          {"indexed": false, "internalType": "uint256", "name": "expiresAt", "type": "uint256"}
        ],
        "name": "EscrowCreated",
        "type": "event"
      },
      {
        "inputs": [
          {"internalType": "bytes32", "name": "escrowId", "type": "bytes32"},
          {"internalType": "address", "name": "beneficiary", "type": "address"},
          {"internalType": "string", "name": "purpose", "type": "string"},
          {"internalType": "uint256", "name": "durationDays", "type": "uint256"},
          {"internalType": "uint256", "name": "amount", "type": "uint256"}
        ],
        "name": "createEscrow",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {"internalType": "bytes32", "name": "escrowId", "type": "bytes32"},
          {"internalType": "bytes32", "name": "paymentId", "type": "bytes32"},
          {"internalType": "uint256", "name": "amount", "type": "uint256"},
          {"internalType": "string", "name": "mpesaRef", "type": "string"}
        ],
        "name": "confirmPayment",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [{"internalType": "bytes32", "name": "escrowId", "type": "bytes32"}],
        "name": "getEscrow",
        "outputs": [
          {
            "components": [
              {"internalType": "bytes32", "name": "escrowId", "type": "bytes32"},
              {"internalType": "address", "name": "sender", "type": "address"},
              {"internalType": "address", "name": "beneficiary", "type": "address"},
              {"internalType": "uint256", "name": "totalAmount", "type": "uint256"},
              {"internalType": "uint256", "name": "remainingAmount", "type": "uint256"},
              {"internalType": "uint256", "name": "releasedAmount", "type": "uint256"},
              {"internalType": "string", "name": "purpose", "type": "string"},
              {"internalType": "uint256", "name": "expiresAt", "type": "uint256"},
              {"internalType": "bool", "name": "isActive", "type": "bool"},
              {"internalType": "bool", "name": "isRefunded", "type": "bool"},
              {"internalType": "uint256", "name": "createdAt", "type": "uint256"}
            ],
            "internalType": "struct SimpleEscrowUSDC.Escrow",
            "name": "",
            "type": "tuple"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [{"internalType": "bytes32", "name": "", "type": "bytes32"}],
        "name": "escrowExists",
        "outputs": [{"internalType": "bool", "name": "", "type": "bool"}],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [{"internalType": "bytes32", "name": "paymentId", "type": "bytes32"}],
        "name": "isPaymentIdUsed",
        "outputs": [{"internalType": "bool", "name": "", "type": "bool"}],
        "stateMutability": "view",
        "type": "function"
      }
    ];

    // Create contract factory
    const contractFactory = new ethers.ContractFactory(
      contractAbi,
      contractBytecode,
      this.wallet
    );

    try {
      // Deploy with constructor arguments
      const contract = await contractFactory.deploy(
        backendServiceAddress,
        feeCollectorAddress,
        usdcTokenAddress,
        {
          gasLimit: 2000000, // 2M gas limit
        }
      );

      // Wait for deployment
      const deploymentReceipt = await contract.waitForDeployment();
      const receipt = await contract.deploymentTransaction()?.wait();

      if (!receipt) {
        throw new Error('Deployment receipt not found');
      }

      const result: DeploymentResult = {
        contractAddress: await contract.getAddress(),
        transactionHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        deployerAddress: this.wallet.address,
        constructorArgs: [backendServiceAddress, feeCollectorAddress, usdcTokenAddress],
        gasUsed: receipt.gasUsed.toString(),
      };

      console.log('✅ SimpleEscrowUSDC deployed successfully!');
      console.log('Contract Address:', result.contractAddress);
      console.log('Transaction:', result.transactionHash);
      console.log('Block Number:', result.blockNumber);
      console.log('Gas Used:', result.gasUsed);

      return result;
    } catch (error) {
      console.error('❌ Contract deployment failed:', error);
      throw error;
    }
  }

  /**
   * Verify deployment was successful
   */
  async verifyDeployment(contractAddress: string): Promise<boolean> {
    try {
      const code = await this.provider.getCode(contractAddress);
      return code !== '0x';
    } catch (error) {
      console.error('Verification failed:', error);
      return false;
    }
  }

  /**
   * Get current network info
   */
  async getNetworkInfo() {
    const network = await this.provider.getNetwork();
    const balance = await this.provider.getBalance(this.wallet.address);
    
    return {
      chainId: network.chainId.toString(),
      name: network.name,
      deployerAddress: this.wallet.address,
      deployerBalance: ethers.formatEther(balance),
    };
  }
}

export default ContractDeploymentService;
import { ethers } from 'ethers';
import { getSimpleEscrowUSDCArtifact, loadContractArtifact } from '../utils/contractUtils.js';

// Get contract artifact using the robust utility
const artifact = getSimpleEscrowUSDCArtifact();
const contractAbi = artifact.abi;

// If USDC artifact doesn't have bytecode, use SimpleEscrow bytecode as fallback
let contractBytecode: string;
if (artifact.bytecode) {
  contractBytecode = artifact.bytecode;
} else {
  try {
    const fallbackArtifact = loadContractArtifact('SimpleEscrow.json');
    if (!fallbackArtifact.bytecode) {
      throw new Error('SimpleEscrow artifact also missing bytecode');
    }
    contractBytecode = fallbackArtifact.bytecode;
  } catch (error) {
    throw new Error('No bytecode found in either SimpleEscrowUSDC or SimpleEscrow artifacts');
  }
}

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

    // Using loaded contract bytecode and ABI from artifact file

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
   * Estimate gas needed for contract deployment
   */
  async estimateDeploymentGas(
    backendServiceAddress: string, 
    feeCollectorAddress: string,
    usdcTokenAddress: string = BASE_USDC_CONTRACT
  ): Promise<bigint> {
    // Use loaded bytecode and ABI from artifact
    const estimationAbi = contractAbi.filter(item => item.type === 'constructor');

    try {
      const contractFactory = new ethers.ContractFactory(estimationAbi, contractBytecode, this.wallet);
      
      const deploymentTx = await contractFactory.getDeployTransaction(
        backendServiceAddress,
        feeCollectorAddress,
        usdcTokenAddress
      );

      const gasEstimate = await this.provider.estimateGas(deploymentTx);
      return gasEstimate;
    } catch (error) {
      console.error('Gas estimation failed:', error);
      throw error;
    }
  }

  /**
   * Alias for deploySimpleEscrowUSDC for backward compatibility
   */
  async deploySimpleEscrow(params: DeployContractParams): Promise<DeploymentResult> {
    return this.deploySimpleEscrowUSDC(params);
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
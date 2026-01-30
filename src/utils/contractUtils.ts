import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Robust path resolution that works in both development and production environments
 */
function getBlockchainArtifactPath(filename: string): string {
  // Try different possible locations for the blockchain artifacts
  const possiblePaths = [
    // Development: from utils/ to blockchain/
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../blockchain', filename),
    // Production build: from dist/utils/ to blockchain/
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../blockchain', filename),
    // Alternative production: from project root
    path.resolve(process.cwd(), 'src/blockchain', filename),
    // Another production alternative: dist location
    path.resolve(process.cwd(), 'dist/blockchain', filename),
  ];

  for (const artifactPath of possiblePaths) {
    if (fs.existsSync(artifactPath)) {
      return artifactPath;
    }
  }

  throw new Error(`Contract artifact ${filename} not found. Searched paths: ${possiblePaths.join(', ')}`);
}

/**
 * Load contract artifact (ABI and bytecode) safely
 */
export function loadContractArtifact(filename: string): { abi: any; bytecode?: string } {
  try {
    const artifactPath = getBlockchainArtifactPath(filename);
    const content = fs.readFileSync(artifactPath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error(`Failed to load contract artifact ${filename}:`, error);
    throw error;
  }
}

/**
 * Get SimpleEscrow contract ABI
 */
export function getSimpleEscrowAbi(): any[] {
  const artifact = loadContractArtifact('SimpleEscrow.json');
  return artifact.abi;
}

/**
 * Get SimpleEscrowUSDC contract ABI and bytecode
 */
export function getSimpleEscrowUSDCArtifact(): { abi: any[]; bytecode?: string } {
  const artifact = loadContractArtifact('SimpleEscrowUSDC.json');
  return {
    abi: artifact.abi,
    bytecode: artifact.bytecode // Optional - some artifacts may not have bytecode
  };
}
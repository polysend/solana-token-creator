#!/usr/bin/env bun
import { program } from 'commander';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from '@solana/spl-token';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

// Importing prompt-sync with CommonJS style for compatibility
const promptSync = require('prompt-sync')({ sigint: true });

// Save token creation state to a JSON file
function saveTokenState(walletPath, state) {
  const stateDir = dirname(walletPath);
  const walletName = walletPath.split('/').pop().replace('.json', '');
  // Include cluster in the state filename to keep states separate for different networks
  const clusterSuffix = options.url ? 'custom' : options.cluster;
  const statePath = join(stateDir, `${walletName}-token-state-${clusterSuffix}.json`);
  
  // Add cluster info to the state
  state.cluster = options.cluster;
  state.customUrl = options.url || null;
  
  writeFileSync(statePath, JSON.stringify(state, null, 2));
  console.log(`Token creation state saved to: ${statePath}`);
}

// Load token creation state from a JSON file if it exists
function loadTokenState(walletPath) {
  const stateDir = dirname(walletPath);
  const walletName = walletPath.split('/').pop().replace('.json', '');
  // Include cluster in the state filename to keep states separate for different networks
  const clusterSuffix = options.url ? 'custom' : options.cluster;
  const statePath = join(stateDir, `${walletName}-token-state-${clusterSuffix}.json`);
  
  if (existsSync(statePath)) {
    try {
      const stateData = readFileSync(statePath, 'utf-8');
      return JSON.parse(stateData);
    } catch (error) {
      console.warn(`Could not load state file: ${error.message}`);
      return null;
    }
  }
  return null;
}

program
  .name('solana-token-creator')
  .description('Create a custom token on Solana devnet in one step')
  .version('1.0.0')
  .option('-n, --name <string>', 'Token name')
  .option('-s, --symbol <string>', 'Token symbol')
  .option('-d, --decimals <number>', 'Token decimals', '9')
  .option('-a, --amount <number>', 'Initial supply amount', '1000000')
  .option('-k, --keypair <path>', 'Path to keypair file')
  .option('-g, --generate-wallet', 'Generate a new wallet')
  .option('-o, --output <path>', 'Output directory for new wallets')
  .option('-w, --wallet-name <string>', 'Name for the new wallet file (without extension)')
  .option('-c, --cluster <string>', 'Solana cluster to use (mainnet, devnet, testnet, localhost)', 'devnet')
  .option('-u, --url <string>', 'Custom RPC URL (overrides cluster option)')
  .parse(process.argv);

const options = program.opts();

// Function to generate a new wallet
function generateWallet(outputPath, walletName) {
  // Create file path for the wallet
  const walletPath = join(outputPath, `${walletName}.json`);
  
  // Check if wallet already exists
  if (existsSync(walletPath)) {
    console.log(`Wallet already exists at: ${walletPath}`);
    console.log('Using existing wallet instead of generating a new one');
    
    // Load the existing wallet
    const keypairFile = readFileSync(walletPath, 'utf-8');
    const keypairData = JSON.parse(keypairFile);
    const existingWallet = Keypair.fromSecretKey(new Uint8Array(keypairData));
    
    console.log(`Wallet public key: ${existingWallet.publicKey.toString()}`);
    return existingWallet;
  }
  
  // Generate a new keypair if wallet doesn't exist
  const newWallet = Keypair.generate();
  
  // Ensure output directory exists
  if (!existsSync(outputPath)) {
    mkdirSync(outputPath, { recursive: true });
  }
  
  // Save the keypair to file
  writeFileSync(walletPath, JSON.stringify(Array.from(newWallet.secretKey)));
  
  console.log(`New wallet generated and saved to: ${walletPath}`);
  console.log(`Wallet public key: ${newWallet.publicKey.toString()}`);
  
  return newWallet;
}

async function createToken() {
  // Define wallet keypair
  let walletKeypair;
  
  // Check if we need to generate a wallet
  if (options.generateWallet) {
    const outputDir = options.output || join(process.cwd(), 'wallets');
    const walletName = options.walletName || `solana-wallet-${Date.now()}`;
    
    console.log(`Generating new wallet with name: ${walletName}`);
    walletKeypair = generateWallet(outputDir, walletName);
    
    // Save path to the generated wallet for future reference
    options.keypair = join(outputDir, `${walletName}.json`);
  } 
  // If not generating but no keypair specified, ask user
  else if (!options.keypair) {
    console.log('No wallet specified. You have the following options:');
    console.log('1. Generate a new wallet');
    console.log('2. Use an existing wallet file');
    const choice = promptSync('Enter your choice (1 or 2): ');
    
    if (choice === '1') {
      const outputDir = promptSync('Enter directory for the wallet (default: ./wallets): ') || join(process.cwd(), 'wallets');
      const walletName = promptSync('Enter a name for the wallet file (default: solana-wallet): ') || `solana-wallet-${Date.now()}`;
      
      walletKeypair = generateWallet(outputDir, walletName);
      options.keypair = join(outputDir, `${walletName}.json`);
    } else {
      const walletPath = promptSync('Enter the path to your existing wallet file: ');
      if (!walletPath) {
        console.error('No wallet path provided. Exiting.');
        process.exit(1);
      }
      options.keypair = walletPath;
    }
  }
  
  // Load wallet if not already loaded through generation
  if (!walletKeypair) {
    try {
      const keypairFile = readFileSync(options.keypair, 'utf-8');
      const keypairData = JSON.parse(keypairFile);
      walletKeypair = Keypair.fromSecretKey(new Uint8Array(keypairData));
    } catch (error) {
      console.error('Failed to load keypair from', options.keypair);
      console.error('Error:', error.message);
      process.exit(1);
    }
  }

  console.log(`Using wallet: ${walletKeypair.publicKey.toString()}`);
  
  // Determine cluster URL based on options
  let clusterUrl;
  if (options.url) {
    clusterUrl = options.url;
    console.log(`Using custom RPC URL: ${clusterUrl}`);
  } else {
    switch (options.cluster) {
      case 'mainnet':
        clusterUrl = 'https://api.mainnet-beta.solana.com';
        break;
      case 'devnet':
        clusterUrl = 'https://api.devnet.solana.com';
        break;
      case 'testnet':
        clusterUrl = 'https://api.testnet.solana.com';
        break;
      case 'localhost':
        clusterUrl = 'http://localhost:8899';
        break;
      default:
        clusterUrl = 'https://api.devnet.solana.com';
    }
    console.log(`Using Solana ${options.cluster} cluster: ${clusterUrl}`);
  }
  
  // Check for existing state
  const tokenState = loadTokenState(options.keypair);
  let mint;
  
  // If we have saved state with a mint address, we can resume the process
  if (tokenState && tokenState.mintAddress) {
    console.log(`Found existing token state. Resuming from previous run.`);
    console.log(`Using token mint address: ${tokenState.mintAddress}`);
    mint = new PublicKey(tokenState.mintAddress);
  }
  
  // Connect to specified cluster
  const connection = new Connection(clusterUrl, 'confirmed');
  console.log(`Connected to Solana cluster at: ${clusterUrl}`);
  
  try {
    // Check wallet balance
    const balance = await connection.getBalance(walletKeypair.publicKey);
    const solBalance = balance / 1000000000; // Convert lamports to SOL
    console.log(`Current wallet balance: ${solBalance.toFixed(4)} SOL`);
    
    // Request airdrop if balance is low (only for non-mainnet)
    if (balance < 1000000000 && options.cluster !== 'mainnet' && !options.url) { // 1 SOL in lamports
      console.log('Wallet balance is less than 1 SOL. An airdrop is needed.');
      const needAirdrop = promptSync('Attempt to request an airdrop? (y/n): ');
      
      if (needAirdrop.toLowerCase() === 'y') {
        console.log('Requesting airdrop of 1 SOL...');
        try {
          const signature = await connection.requestAirdrop(walletKeypair.publicKey, 1000000000);
          await connection.confirmTransaction(signature);
          console.log('Airdrop received successfully!');
          
          // Verify new balance
          const newBalance = await connection.getBalance(walletKeypair.publicKey);
          const newSolBalance = newBalance / 1000000000;
          console.log(`New wallet balance: ${newSolBalance.toFixed(4)} SOL`);
        } catch (error) {
          console.warn('Airdrop failed. This is common due to rate limiting or network issues.');
          console.warn('Please fund your wallet manually or try again later.');
          console.log(`Your wallet address: ${walletKeypair.publicKey.toString()}`);
          
          const proceed = promptSync('Do you want to proceed without the airdrop? (y/n): ');
          if (proceed.toLowerCase() !== 'y') {
            console.log('Exiting. Please try again later or fund your wallet manually.');
            process.exit(0);
          }
          console.log('Proceeding without airdrop...');
        }
      }
    } else if (options.cluster === 'mainnet' || options.url) {
      console.log('Note: Airdrops are not available on mainnet or custom RPC endpoints.');
      console.log('You need to have SOL in your wallet already.');
    }
    
    // Check if we have enough balance to proceed
    const currentBalance = await connection.getBalance(walletKeypair.publicKey);
    if (currentBalance < 10000000) { // 0.01 SOL minimum
      console.error('Insufficient balance to proceed with token creation.');
      console.error(`Current balance: ${(currentBalance / 1000000000).toFixed(4)} SOL`);
      console.error('You need at least 0.01 SOL to create a token.');
      console.log('Please fund your wallet and try again.');
      process.exit(1);
    }
    
    // Create token mint if we don't have one yet
    if (!mint) {
      console.log(`Creating token with symbol: ${options.symbol}, decimals: ${options.decimals}`);
      mint = await createMint(
        connection,
        walletKeypair,
        walletKeypair.publicKey,
        walletKeypair.publicKey,
        Number(options.decimals)
      );
      console.log(`Token created successfully! Mint address: ${mint.toString()}`);
      
      // Save state after mint creation
      saveTokenState(options.keypair, {
        mintAddress: mint.toString(),
        name: options.name,
        symbol: options.symbol,
        decimals: options.decimals,
        supply: options.amount,
        tokenAccountCreated: false,
        initialSupplyMinted: false
      });
    }
    
    // Create associated token account if needed
    let tokenAccount;
    if (tokenState && tokenState.tokenAccountCreated && tokenState.tokenAccountAddress) {
      console.log(`Using existing token account: ${tokenState.tokenAccountAddress}`);
      tokenAccount = { address: new PublicKey(tokenState.tokenAccountAddress) };
    } else {
      console.log('Creating associated token account...');
      tokenAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        walletKeypair,
        mint,
        walletKeypair.publicKey
      );
      console.log(`Token account created: ${tokenAccount.address.toString()}`);
      
      // Update state after token account creation
      saveTokenState(options.keypair, {
        mintAddress: mint.toString(),
        name: options.name,
        symbol: options.symbol,
        decimals: options.decimals,
        supply: options.amount,
        tokenAccountCreated: true,
        tokenAccountAddress: tokenAccount.address.toString(),
        initialSupplyMinted: false
      });
    }
    
    // Mint initial supply if needed
    if (!(tokenState && tokenState.initialSupplyMinted)) {
      const initialSupply = Number(options.amount) * (10 ** Number(options.decimals));
      console.log(`Minting ${options.amount} tokens to your wallet...`);
      await mintTo(
        connection,
        walletKeypair,
        mint,
        tokenAccount.address,
        walletKeypair,
        BigInt(initialSupply)
      );
      console.log('Tokens minted successfully!');
      
      // Update state after minting
      saveTokenState(options.keypair, {
        mintAddress: mint.toString(),
        name: options.name,
        symbol: options.symbol,
        decimals: options.decimals,
        supply: options.amount,
        tokenAccountCreated: true,
        tokenAccountAddress: tokenAccount.address.toString(),
        initialSupplyMinted: true
      });
    } else {
      console.log('Initial token supply was already minted. Skipping this step.');
    }
    
    // Output success message with token details
    console.log('\n=============== TOKEN CREATED SUCCESSFULLY ===============');
    console.log(`Token Name: ${options.name}`);
    console.log(`Token Symbol: ${options.symbol}`);
    console.log(`Token Mint Address: ${mint.toString()}`);
    console.log(`Decimals: ${options.decimals}`);
    console.log(`Initial Supply: ${options.amount}`);
    console.log(`Owner Wallet: ${walletKeypair.publicKey.toString()}`);
    console.log('==========================================================');
    console.log('\nNext Steps:');
    console.log('1. You can add metadata using Metaplex (https://docs.metaplex.com/)');
    console.log('2. Add your token to a wallet like Phantom or Sollet');
    console.log('3. View your token on Solana Explorer: https://explorer.solana.com/address/' + mint.toString() + getClusterParam());
    
  } catch (error) {
    console.error('Error creating token:', error);
    process.exit(1);
  }
}

// Determine cluster parameter for explorer URL
function getClusterParam() {
  if (options.url) {
    // Custom URL can't be directly linked in explorer
    return '';
  }
  
  switch (options.cluster) {
    case 'mainnet':
      return '';  // mainnet is default in explorer
    case 'devnet':
      return '?cluster=devnet';
    case 'testnet':
      return '?cluster=testnet';
    case 'localhost':
      return '?cluster=custom&customUrl=http%3A%2F%2Flocalhost%3A8899';
    default:
      return '?cluster=devnet';
  }
}

// Validate and collect required options if not provided
if (!options.name) {
  options.name = promptSync('Enter token name: ');
  if (!options.name) {
    console.error('Error: Token name is required');
    process.exit(1);
  }
}

if (!options.symbol) {
  options.symbol = promptSync('Enter token symbol: ');
  if (!options.symbol) {
    console.error('Error: Token symbol is required');
    process.exit(1);
  }
}

// Run the token creation
createToken();

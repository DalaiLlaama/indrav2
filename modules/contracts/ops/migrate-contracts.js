const { CF_PATH, EXPECTED_CONTRACT_NAMES_IN_NETWORK_CONTEXT: coreContracts } = require(`@connext/types`);
const fs = require(`fs`);
const eth = require(`ethers`);
const tokenArtifacts = require(`openzeppelin-solidity/build/contracts/ERC20Mintable.json`);

const appContracts = [
  `SimpleLinkedTransferApp`,
  `SimpleTransferApp`,
  `SimpleTwoPartySwapApp`
];

console.log(`Core contracts: ${JSON.stringify(coreContracts)}`);

const artifacts = {};
for (const contract of coreContracts) {
  try {
    artifacts[contract] = require(`../build/${contract}.json`);
    console.log(`Imported adjudicator contract: ${contract}`);
  } catch (e) {
    artifacts[contract] = require(`../build/${contract}.json`);
    console.log(`Imported funding contract: ${contract}`);
  }
}

for (const contract of appContracts) {
  artifacts[contract] = require(`../build/${contract}.json`);
}

const { EtherSymbol, Zero } = eth.constants;
const { formatEther, parseEther } = eth.utils;

////////////////////////////////////////
// Environment Setup

const botMnemonics = [
  `humble sense shrug young vehicle assault destroy cook property average silent travel`,
  `roof traffic soul urge tenant credit protect conduct enable animal cinnamon adult`,
];
const ganacheId = 4447;
const addressBookPath = `./address-book.json`;
const addressBook = JSON.parse(fs.readFileSync(addressBookPath, `utf8`) || `{}`);

// Global scope vars
let chainId;
let wallet;
let mnemonic;

////////////////////////////////////////
// Helper Functions

const getSavedData = (contractName, property) => {
  try {
    return addressBook[chainId][contractName][property];
  } catch (e) {
    return undefined;
  }
};

// Write addressBook to disk
const saveAddressBook = (addressBook) => {
  try {
    fs.writeFileSync(addressBookPath, JSON.stringify(addressBook,null,2));
  } catch (e) {
    console.log(`Error saving artifacts: ${e}`);
  }
};

// Simple sanity checks to make sure contracts from our address book have been deployed
const contractIsDeployed = async (address) => {
  if (!address || address === ``) {
    console.log(`This contract is not in our address book.`);
    return false;
  }
  const bytecode = await wallet.provider.getCode(address);
  console.log(`Got bytecode hash for ${address}: ${eth.utils.keccak256(bytecode)}`);
  if (bytecode === `0x00` || bytecode === `0x`) {
    console.log(`No bytecode exists at the address in our address book`);
    return false;
  }
  return true;
};

const deployContract = async (name, artifacts, args) => {
  console.log(`\nChecking for valid ${name} contract...`);
  const savedAddress = getSavedData(name, `address`);
  if (await contractIsDeployed(savedAddress)) {
    console.log(`${name} is up to date, no action required\nAddress: ${savedAddress}`);
    return new eth.Contract(savedAddress, artifacts.abi, wallet);
  }
  const factory = eth.ContractFactory.fromSolidity(artifacts);
  const contract = await factory.connect(wallet).deploy(...args.map(a=>a.value));
  const txHash = contract.deployTransaction.hash;
  console.log(`Sent transaction to deploy ${name}, txHash: ${txHash}`);
  await wallet.provider.waitForTransaction(txHash);
  const address = contract.address;
  console.log(`${name} has been deployed to address: ${address}`);
  const bytecode = eth.utils.keccak256(await wallet.provider.getCode(address));
  // Update address-book w new address + the args we deployed with
  const saveArgs = {};
  args.forEach(a=> saveArgs[a.name] = a.value);
  if (!addressBook[chainId]) addressBook[chainId] = {};
  if (!addressBook[chainId][name]) addressBook[chainId][name] = {};
  addressBook[chainId][name] = { address, bytecode, txHash, ...saveArgs };
  saveAddressBook(addressBook);
  return contract;
};

const sendGift = async (address, token) => {
  const ethGift = `100000`; // 1mil eth by default
  const tokenGift = `1000000`;
  const ethBalance = await wallet.provider.getBalance(address);
  if (ethBalance.eq(Zero)) {
    console.log(`\nSending ${EtherSymbol} ${ethGift} to ${address}`);
    const tx = await wallet.sendTransaction({
      to: address,
      value: parseEther(ethGift)
    });
    await wallet.provider.waitForTransaction(tx.hash);
    console.log(`Transaction mined! Hash: ${tx.hash}`);
  } else {
    console.log(`\nAccount ${address} already has ${EtherSymbol} ${formatEther(ethBalance)}`);
  }
  if (token) {
    const tokenBalance = await token.balanceOf(address);
    if (tokenBalance.eq(Zero)) {
      console.log(`Minting ${tokenGift} tokens for ${address}`);
      const tx = await token.mint(address, parseEther(tokenGift));
      await wallet.provider.waitForTransaction(tx.hash);
      console.log(`Transaction mined! Hash: ${tx.hash}`);
    } else {
      console.log(`\nAccount ${address} already has ${formatEther(tokenBalance)} tokens`);
    }
  }
}

////////////////////////////////////////
// Begin executing main migration script in async wrapper function
// First, setup signer & connect to eth provider

;(async function() {
  let provider, balance, nonce, token;

  if (process.env.ETH_PROVIDER) {
    provider = new eth.providers.JsonRpcProvider(process.env.ETH_PROVIDER);
  } else if (process.env.INFURA_KEY) {
    provider = new eth.providers.InfuraProvider(process.env.ETH_NETWORK, process.env.INFURA_KEY);
  } else {
    provider = eth.getDefaultProvider(process.env.ETH_NETWORK);
  }

  if (process.env.ETH_MNEMONIC_FILE) {
    mnemonic = fs.readFileSync(process.env.ETH_MNEMONIC_FILE, `utf8`);
  } else if (process.env.ETH_MNEMONIC) {
    mnemonic = process.env.ETH_MNEMONIC;
  } else {
    console.error(`Couldn't setup signer: no mnemonic found`);
    process.exit(1);
  }
  wallet = eth.Wallet.fromMnemonic(mnemonic).connect(provider); // saved to global scope

  try {
    chainId = (await wallet.provider.getNetwork()).chainId; // saved to global scope
    balance = formatEther(await wallet.getBalance());
    nonce = await wallet.getTransactionCount();
  } catch (e) {
    console.error(`Couldn't connect to eth provider: ${JSON.stringify(provider,null,2)}`);
    process.exit(1);
  }

  // Sanity check: Is our eth provider serving us the correct network?
  const net = process.env.ETH_NETWORK;
  console.log(`\nPreparing to migrate contracts to ${net} network (${chainId})`);
  console.log(`Deployer Wallet: address=${wallet.address} nonce=${nonce} balance=${balance}`);

  ////////////////////////////////////////
  // Deploy contracts

  for (const contract of coreContracts) {
    if (chainId === ganacheId || contract !== `ProxyFactory`) {
      await deployContract(contract, artifacts[contract], []);
    }
  }

  for (const contract of appContracts) {
    await deployContract(contract, artifacts[contract], []);
  }

  // If this network has not token yet, deploy one
  if (chainId === ganacheId || !getSavedData(`Token`, `address`)) {
    token = await deployContract(`Token`, tokenArtifacts, []);
  }

  ////////////////////////////////////////
  // On testnet, give relevant accounts a healthy starting balance

  if (chainId === ganacheId) {
    await sendGift(eth.Wallet.fromMnemonic(mnemonic).address, token);
    await sendGift(eth.Wallet.fromMnemonic(mnemonic, `${CF_PATH}/0`).address, token);
    for (const botMnemonic of botMnemonics) {
      await sendGift(eth.Wallet.fromMnemonic(botMnemonic).address, token);
      await sendGift(eth.Wallet.fromMnemonic(botMnemonic, `${CF_PATH}/0`).address, token);
    }
  }

  ////////////////////////////////////////
  // Take a snapshot of this state

  if (chainId === ganacheId) {
    const snapshotId = await provider.send(`evm_snapshot`, []);
    console.log(`Took an EVM snapshot, id: ${snapshotId}`);
  }

  ////////////////////////////////////////
  // Print summary

  console.log(`\nAll done!`);
  const spent = balance - formatEther(await wallet.getBalance());
  const nTx = (await wallet.getTransactionCount()) - nonce;
  console.log(`Sent ${nTx} transaction${nTx === 1 ? `` : `s`} & spent ${EtherSymbol} ${spent}`);

})();

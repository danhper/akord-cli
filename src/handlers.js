const { getContract, getEncryptedBackupPhraseFromCognito } = require('./helpers');
const fs = require('fs');
var path = require("path");
const {
  askForFilePath,
  askForTransactionId,
  askForAccessType,
  askForStackName,
  askForUploadType,
  askForRole
} = require("./inquirers");
const Wrapper = require("./wrapper");
const WalletFactory = require('./crypto/wallet/wallet-factory');
const MnemonicWallet = require('./crypto/wallet/mnemonic-wallet');
const { fromMembershipContract } = require('./crypto/encryption-keys');
const os = require('os');

function storeWallet(walletData) {
  try {
    fs.writeFileSync(os.homedir() + "/.akord", walletData);
    console.log("Your wallet was stored successfully at: ~/.akord");
  } catch (error) {
    console.log("Oops, something went wrong when storing your wallet: " + error);
    process.exit(0);
  }
}

async function walletConfigureHandler(argv) {
  const keyFile = argv.keyFile;
  try {
    const stringKey = fs.readFileSync(keyFile).toString();
    storeWallet(stringKey);
  } catch (error) {
    console.log("Oops, something went wrong when configuring your wallet: " + error);
    process.exit(0);
  }
}

async function walletImportHandler(argv) {
  const email = argv.email;
  const password = argv.password;

  const encryptedBackupPhrase = await getEncryptedBackupPhraseFromCognito(email, password);
  console.log("Please be patient, importing the wallet may take a while");
  const wallet = await MnemonicWallet.importFromEncBackupPhrase(password, encryptedBackupPhrase);
  storeWallet(JSON.stringify({
    "jwk": wallet.wallet,
    "mnemonic": wallet.backupPhrase
  }));
  const address = await wallet.getAddress();
  const publicKey = wallet.publicKey();
  const signingPublicKey = wallet.signingPublicKey();
  console.log("Your wallet was imported & stored successfully at: ~/.akord");
  console.log("Your wallet address: " + address);
  console.log("Your wallet public key: " + publicKey);
  console.log("Your wallet signing public key: " + signingPublicKey);
  process.exit(0);
}

async function walletGenerateHandler() {
  console.log("Please be patient, generating the wallet may take a while");
  const wallet = await MnemonicWallet.create();
  storeWallet(JSON.stringify({
    "jwk": wallet.wallet,
    "mnemonic": wallet.backupPhrase
  }));
  const address = await wallet.getAddress();
  const publicKey = wallet.publicKey();
  const signingPublicKey = wallet.signingPublicKey();
  console.log("Your wallet was generated & stored successfully at: ~/.akord");
  console.log("Your wallet address: " + address);
  console.log("Your wallet public key: " + publicKey);
  console.log("Your wallet signing public key: " + signingPublicKey);
  console.log("The seed phrase to recover the wallet: " + mnemonic);
  console.log("Please keep it somewhere safe.");
  process.exit(0);
};

async function walletRecoverHandler(argv) {
  const mnemonic = argv.mnemonic;
  console.log("Please be patient, recovering the wallet may take a while");
  const wallet = await MnemonicWallet.recover(mnemonic);
  storeWallet(JSON.stringify({
    "jwk": wallet.wallet,
    "mnemonic": wallet.backupPhrase
  }));
  const address = await wallet.getAddress();
  console.log("Your wallet was imported & stored successfully at: ~/.akord");
  console.log("Your wallet address: " + address);
  process.exit(0);
};

async function vaultCreateHandler(argv) {
  const wallet = await loadWallet();
  const name = argv.name;
  const termsOfAccess = argv.termsOfAccess;

  const wrapper = new Wrapper(wallet);
  const response = await wrapper.dispatch("VAULT_CREATE", {}, { name: name, termsOfAccess: termsOfAccess });
  console.log(response);
  process.exit(0);
}

async function objectReadHandler(argv) {
  const wallet = await loadWallet();
  const objectId = argv.objectId;

  const { objectState, vaultContract, membershipContract, membershipState } = await validateObjectContext(objectId, wallet);

  const encryptionKeys = fromMembershipContract(membershipState);
  const wrapper = new Wrapper(wallet, encryptionKeys, vaultContract, membershipContract);
  const decryptedState = await wrapper.dataEncrypter.decryptState(objectState.state);
  console.log(decryptedState);
  process.exit(0);
}

async function loadWallet() {
  let wallet = {};
  try {
    const config = JSON.parse(fs.readFileSync(os.homedir() + "/.akord").toString());
    if (config.mnemonic) {
      wallet = new MnemonicWallet(config.mnemonic, config.jwk);
      wallet.deriveKeys();
    } else {
      wallet = new WalletFactory("ARWEAVE", config).walletInstance();
    }
    return wallet;
  } catch (error) {
    console.log("Oops, something went wrong when loading your wallet: " + error);
    console.log("Make sure that your keyfile is configured: akord wallet:configure --help");
    process.exit(0);
  }
}

async function vaultRenameHandler(argv) {
  const vaultId = argv.vaultId;
  const name = argv.name;

  await objectUpdate(vaultId, "VAULT_RENAME", { "Object-Contract-Id": vaultId }, { name: name });
}

async function vaultArchiveHandler(argv) {
  const vaultId = argv.vaultId;

  await objectUpdate(vaultId, "VAULT_ARCHIVE", { "Object-Contract-Id": vaultId }, {});
}

async function vaultRestoreHandler(argv) {
  const vaultId = argv.vaultId;

  await objectUpdate(vaultId, "VAULT_RESTORE", { "Object-Contract-Id": vaultId }, {});
}

async function stackCreateHandler(argv) {
  const vaultId = argv.vaultId;
  const file = await _getFile();
  const { name } = await askForStackName();

  await objectCreate(vaultId, "STACK_CREATE", {}, { name: name ? name : file.name, file: file });
}

async function stackUploadRevisionHandler(argv) {
  const stackId = argv.stackId;
  const file = await _getFile();

  await objectUpdate(stackId, "STACK_UPLOAD_REVISION", {}, { file: file });
}

async function _getFile() {
  const { accessType } = await askForAccessType();
  let file = {};
  if (accessType === 'public') {
    const { uploadType } = await askForUploadType();
    if (uploadType === 'transaction id') {
      const { transactionId } = await askForTransactionId();
      file.resourceTx = transactionId;
    }
  } else {
    const { filePath } = await askForFilePath();
    file = getFileFromPath(filePath);
  }
  return file;
}

async function stackRenameHandler(argv) {
  const stackId = argv.stackId;
  const name = argv.name;

  await objectUpdate(stackId, "STACK_RENAME", { "Object-Contract-Id": stackId }, { name: name });
}

async function stackRevokeHandler(argv) {
  const stackId = argv.stackId;

  await objectUpdate(stackId, "STACK_REVOKE", { "Object-Contract-Id": stackId }, {});
}

async function stackRestoreHandler(argv) {
  const stackId = argv.stackId;

  await objectUpdate(stackId, "STACK_RESTORE", { "Object-Contract-Id": stackId }, {});
}

async function stackDeleteHandler(argv) {
  const stackId = argv.stackId;

  await objectUpdate(stackId, "STACK_DELETE", { "Object-Contract-Id": stackId }, {});
}

async function stackMoveHandler(argv) {
  const stackId = argv.stackId;
  const parentFolderId = argv.parentFolderId;

  await objectUpdate(stackId, "STACK_MOVE", { "Object-Contract-Id": stackId }, { folderId: parentFolderId });
}

async function memoCreateHandler(argv) {
  const vaultId = argv.vaultId;
  const message = argv.message;

  await objectCreate(vaultId, "MEMO_CREATE", {}, { message: message });
}

async function folderCreateHandler(argv) {
  const vaultId = argv.vaultId;
  const name = argv.name;
  const parentFolderId = argv.parentFolderId;

  await objectCreate(vaultId, "FOLDER_CREATE", {}, { name: name, folderId: parentFolderId });
}

async function folderRenameHandler(argv) {
  const folderId = argv.folderId;
  const name = argv.name;

  await objectUpdate(folderId, "FOLDER_RENAME", { "Object-Contract-Id": folderId }, { name: name });
}

async function folderMoveHandler(argv) {
  const folderId = argv.folderId;
  const parentFolderId = argv.parentFolderId;

  await objectUpdate(folderId, "FOLDER_MOVE", { "Object-Contract-Id": folderId }, { folderId: parentFolderId });
}

async function folderRevokeHandler(argv) {
  const folderId = argv.folderId;

  await objectUpdate(folderId, "FOLDER_REVOKE", { "Object-Contract-Id": folderId }, {});
}

async function folderRestoreHandler(argv) {
  const folderId = argv.folderId;

  await objectUpdate(folderId, "FOLDER_RESTORE", { "Object-Contract-Id": folderId }, {});
}

async function folderDeleteHandler(argv) {
  const folderId = argv.folderId;

  await objectUpdate(folderId, "FOLDER_DELETE", { "Object-Contract-Id": folderId }, {});
}

function getFileFromPath(filePath) {
  let file = {};
  if (!fs.existsSync(filePath)) {
    console.error("Could not find a file in your filesystem");
    process.exit(0);
  }
  const stats = fs.statSync(filePath);
  file.size = stats.size;
  file.data = fs.readFileSync(filePath);
  file.name = path.basename(filePath);
  return file;
}

async function membershipInviteHandler(argv) {
  const vaultId = argv.vaultId;
  const address = argv.address;

  const { role } = await askForRole();

  await objectCreate(vaultId, "MEMBERSHIP_INVITE", {}, { address: address, role: role });
}

async function membershipAcceptHandler(argv) {
  const membershipId = argv.membershipId;

  await membershipUpdate(membershipId, "MEMBERSHIP_ACCEPT", { "Object-Contract-Id": membershipId }, {});
}

async function membershipRejectHandler(argv) {
  const membershipId = argv.membershipId;

  await membershipUpdate(membershipId, "MEMBERSHIP_REJECT", { "Object-Contract-Id": membershipId }, {});
}

async function membershipRevokeHandler(argv) {
  const membershipId = argv.membershipId;
  await objectUpdate(membershipId, "MEMBERSHIP_REVOKE", { "Object-Contract-Id": membershipId }, {});
}

async function membershipUpdate(membershipId, actionRef, header, body) {
  const wallet = await loadWallet();
  const membershipContract = getContract(membershipId, wallet);
  const membershipState = await membershipContract.readState();
  const vaultContract = getContract(membershipState.state.vaultId, wallet.wallet);
  const encryptionKeys = fromMembershipContract(membershipState.state);
  const wrapper = new Wrapper(wallet, encryptionKeys, vaultContract, membershipContract);
  const response = await wrapper.dispatch(actionRef, header, body);
  console.log(response);
  process.exit(0);
}

async function objectUpdate(objectId, actionRef, header, body) {
  const wallet = await loadWallet();
  const { vaultContract, membershipContract, membershipState } = await validateObjectContext(objectId, wallet);
  const encryptionKeys = fromMembershipContract(membershipState);
  const wrapper = new Wrapper(wallet, encryptionKeys, vaultContract, membershipContract);
  const response = await wrapper.dispatch(actionRef, header, body);
  console.log(response);
  process.exit(0);
}

async function objectCreate(vaultId, actionRef, header, body) {
  const wallet = await loadWallet();
  const { vaultContract, membershipContract, membershipState } = await validateVaultContext(vaultId, wallet);
  const encryptionKeys = fromMembershipContract(membershipState);
  const wrapper = new Wrapper(wallet, encryptionKeys, vaultContract, membershipContract);
  const response = await wrapper.dispatch(actionRef, header, body);
  console.log(response);
  process.exit(0);
}

async function validateVaultContext(vaultId, wallet) {
  const vaultContract = getContract(vaultId, wallet.wallet);
  const vaultState = await vaultContract.readState();
  const address = await wallet.getAddress();
  if (vaultState && vaultState.state && vaultState.state.memberships) {
    for (let membershipId of vaultState.state.memberships) {
      const membershipContract = getContract(membershipId, wallet.wallet);
      const memberState = await membershipContract.readState();
      if (memberState.state.address === address) {
        return { membershipState: memberState.state, vaultContract, membershipContract };
      }
    }
  }
  console.error("Unable to validate vault context: " + vaultId);
  process.exit(0);
}

async function validateObjectContext(objectId, wallet) {
  const objectState = await getContract(objectId, wallet.wallet).readState();
  const { vaultContract, membershipContract, membershipState } = await validateVaultContext(objectState.state.vaultId || objectState.state.id, wallet);
  return { objectState, vaultContract, membershipContract, membershipState }
}

module.exports = {
  vaultCreateHandler,
  vaultRenameHandler,
  vaultArchiveHandler,
  vaultRestoreHandler,
  memoCreateHandler,
  stackCreateHandler,
  stackUploadRevisionHandler,
  stackRenameHandler,
  stackRevokeHandler,
  stackRestoreHandler,
  stackMoveHandler,
  stackDeleteHandler,
  folderCreateHandler,
  folderRenameHandler,
  folderMoveHandler,
  folderRevokeHandler,
  folderRestoreHandler,
  folderDeleteHandler,
  membershipInviteHandler,
  membershipRevokeHandler,
  membershipAcceptHandler,
  membershipRejectHandler,
  objectReadHandler,
  walletConfigureHandler,
  walletGenerateHandler,
  walletImportHandler,
  walletRecoverHandler
}
export interface SubaddressAllocation {
  address: string;
  accountIndex: number;
  subaddressIndex: number;
}

export interface MoneroTransfer {
  txHash: string;
  amountAtomic: bigint;
  confirmations: number;
  accountIndex: number;
  subaddressIndex: number;
  address: string;
  seenAt: Date;
}

export interface WalletVersionInfo {
  version: number;
}

export interface WalletHeightInfo {
  height: number;
}

export interface MonerodInfo {
  height: number;
  targetHeight: number;
  synchronized: boolean;
}

export interface MoneroPaymentAdapter {
  createSubaddress(label: string): Promise<SubaddressAllocation>;
  refresh(): Promise<void>;
  getIncomingTransfers(args: {
    accountIndex: number;
    subaddressIndices: number[];
  }): Promise<MoneroTransfer[]>;
  getWalletHeight(): Promise<WalletHeightInfo>;
  getVersion(): Promise<WalletVersionInfo>;
}

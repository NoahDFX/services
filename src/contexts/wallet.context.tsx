import { Blockchain, Utils, useApiSession, useAuth, useSessionContext, useUserContext } from '@dfx.swiss/react';
import { Router } from '@remix-run/router';
import { PropsWithChildren, createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useStore } from '../hooks/store.hook';
import { useAppHandlingContext } from './app-handling.context';
import { useBalanceContext } from './balance.context';

const SignatureFormat =
  /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[A-Fa-f0-9]{64})$/;

export enum WalletType {
  META_MASK = 'MetaMask',
  ALBY = 'Alby',
  LEDGER_BTC = 'LedgerBtc',
  LEDGER_ETH = 'LedgerEth',
  BITBOX_BTC = 'BitBoxBtc',
  BITBOX_ETH = 'BitBoxEth',
  TREZOR_BTC = 'TrezorBtc',
  TREZOR_ETH = 'TrezorEth',
  CLI_BTC = 'CliBtc',
  CLI_XMR = 'CliXmr',
  CLI_ETH = 'CliEth',
  DFX_TARO = 'DfxTaro',
  WALLET_CONNECT = 'WalletConnect',
  CAKE = 'Cake',
  MONERO = 'Monero',
  MAIL = 'Mail',
}

export const WalletBlockchains: { [w in WalletType]?: Blockchain[] } = {
  [WalletType.META_MASK]: [
    Blockchain.ETHEREUM,
    Blockchain.ARBITRUM,
    Blockchain.OPTIMISM,
    Blockchain.POLYGON,
    Blockchain.BASE,
    Blockchain.HAQQ,
    Blockchain.BINANCE_SMART_CHAIN,
  ],
  [WalletType.ALBY]: [Blockchain.LIGHTNING],
  [WalletType.LEDGER_BTC]: [Blockchain.BITCOIN],
  [WalletType.LEDGER_ETH]: [Blockchain.ETHEREUM, Blockchain.ARBITRUM, Blockchain.OPTIMISM, Blockchain.POLYGON],
  [WalletType.BITBOX_BTC]: [Blockchain.BITCOIN],
  [WalletType.BITBOX_ETH]: [Blockchain.ETHEREUM, Blockchain.ARBITRUM, Blockchain.OPTIMISM, Blockchain.POLYGON],
  [WalletType.TREZOR_BTC]: [Blockchain.BITCOIN],
  [WalletType.TREZOR_ETH]: [Blockchain.ETHEREUM, Blockchain.ARBITRUM, Blockchain.OPTIMISM, Blockchain.POLYGON],
  [WalletType.CLI_BTC]: [Blockchain.BITCOIN],
  [WalletType.CLI_XMR]: [Blockchain.MONERO],
  [WalletType.CLI_ETH]: [
    Blockchain.ETHEREUM,
    Blockchain.ARBITRUM,
    Blockchain.OPTIMISM,
    Blockchain.POLYGON,
    Blockchain.BASE,
    Blockchain.HAQQ,
    Blockchain.BINANCE_SMART_CHAIN,
  ],
  [WalletType.DFX_TARO]: [Blockchain.LIGHTNING],
  [WalletType.WALLET_CONNECT]: [
    Blockchain.ETHEREUM,
    Blockchain.ARBITRUM,
    Blockchain.OPTIMISM,
    Blockchain.POLYGON,
    Blockchain.BASE,
    Blockchain.HAQQ,
    Blockchain.BINANCE_SMART_CHAIN,
  ],
  [WalletType.CAKE]: [Blockchain.MONERO],
  [WalletType.MONERO]: [Blockchain.MONERO],
};

export function supportsBlockchain(wallet: WalletType, blockchain: Blockchain): boolean {
  const supportedChains = WalletBlockchains[wallet];
  return !supportedChains || supportedChains.includes(blockchain);
}

interface WalletInterface {
  isInitialized: boolean;
  blockchain?: Blockchain;
  switchBlockchain: (to: Blockchain) => void;
  login: (
    wallet: WalletType,
    address: string,
    blockchain: Blockchain,
    onSignMessage: (address: string, message: string) => Promise<string>,
  ) => Promise<void>;
  setSession: (wallet: WalletType, blockchain: Blockchain, session: string) => Promise<void>;
  activeWallet: WalletType | undefined;
}

interface WalletContextProps extends PropsWithChildren {
  router: Router;
}

const WalletContext = createContext<WalletInterface>(undefined as any);

export function useWalletContext(): WalletInterface {
  return useContext(WalletContext);
}

export function WalletContextProvider(props: WalletContextProps): JSX.Element {
  const { isInitialized: isSessionInitialized, isLoggedIn, logout } = useSessionContext();
  const { updateSession } = useApiSession();
  const api = useSessionContext();
  const { isInitialized: isParamsInitialized, params: appParams } = useAppHandlingContext();
  const { getSignMessage } = useAuth();
  const { readBalances } = useBalanceContext();
  const { activeWallet: activeWalletStore } = useStore();
  const { addDiscountCode } = useUserContext();

  const [isInitialized, setIsInitialized] = useState(false);
  const [activeWallet, setActiveWallet] = useState<WalletType | undefined>(activeWalletStore.get());
  const [activeBlockchain, setActiveBlockchain] = useState<Blockchain>();

  // initialize
  useEffect(() => {
    if (isSessionInitialized && !isLoggedIn) {
      setWallet();
      if (isInitialized) readBalances(undefined);
    }

    if (isSessionInitialized && isInitialized && isLoggedIn && appParams.specialCode) {
      addDiscountCode(appParams.specialCode).catch(() => undefined);
    }
  }, [isSessionInitialized, isLoggedIn, isInitialized]);

  useEffect(() => {
    if (isParamsInitialized)
      handleParamSession().then((hasSession) => {
        if (hasSession) {
          setWallet(appParams.type as WalletType);
          appParams.redirect && props.router.navigate(appParams.redirect);
        }
        setIsInitialized(true);
      });
  }, [isParamsInitialized]);

  async function handleParamSession(): Promise<boolean> {
    try {
      if (appParams.address && appParams.signature) {
        if (!SignatureFormat.test(appParams.signature)) throw new Error('Invalid signature');

        await createSession(appParams.address, appParams.signature);
        return true;
      } else if (appParams.session && Utils.isJwt(appParams.session)) {
        updateSession(appParams.session);
        return true;
      }
    } catch (e) {
      logout();
    }

    return false;
  }

  function setWallet(walletType?: WalletType) {
    setActiveWallet(walletType);
    walletType ? activeWalletStore.set(walletType) : activeWalletStore.remove();
  }

  // public API
  async function login(
    wallet: WalletType,
    address: string,
    blockchain: Blockchain,
    onSignMessage: (address: string, message: string) => Promise<string>,
  ): Promise<void> {
    try {
      const message = await getSignMessage(address);
      const signature = await onSignMessage(address, message);
      await createSession(address, signature);
    } catch (e) {
      api.logout();
      setWallet();

      throw e;
    }

    setWallet(wallet);
    setActiveBlockchain(blockchain);
  }

  async function setSession(wallet: WalletType, blockchain: Blockchain, session: string): Promise<void> {
    updateSession(session);

    setWallet(wallet);
    setActiveBlockchain(blockchain);
  }

  async function createSession(address: string, signature: string): Promise<string> {
    const session =
      (await api.login(address, signature, appParams.specialCode)) ??
      (await api.signUp(address, signature, appParams.wallet, appParams.refcode, appParams.specialCode));
    if (!session) throw new Error('Failed to create session');

    return session;
  }

  const context: WalletInterface = useMemo(
    () => ({
      isInitialized: isInitialized && isSessionInitialized && isParamsInitialized,
      blockchain: activeBlockchain,
      switchBlockchain: setActiveBlockchain,
      login,
      setSession,
      activeWallet,
    }),
    [isInitialized, isSessionInitialized, isParamsInitialized, activeWallet, activeBlockchain, api, appParams],
  );

  return <WalletContext.Provider value={context}>{props.children}</WalletContext.Provider>;
}

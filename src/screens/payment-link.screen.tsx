import { ApiError, Blockchain, Utils } from '@dfx.swiss/react';
import {
  AlignContent,
  CopyButton,
  Form,
  SpinnerSize,
  SpinnerVariant,
  StyledCollapsible,
  StyledDataTable,
  StyledDataTableExpandableRow,
  StyledDataTableRow,
  StyledDropdown,
  StyledLoadingSpinner,
  StyledVerticalStack,
} from '@dfx.swiss/react-components';
import copy from 'copy-to-clipboard';
import { useEffect, useRef, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useSearchParams } from 'react-router-dom';
import { ErrorHint } from 'src/components/error-hint';
import { QrBasic } from 'src/components/payment/qr-code';
import {
  CompatibleWallets,
  PaymentStandards,
  PaymentStandardType,
  RecommendedWallets,
} from 'src/config/payment-link-wallets';
import { useSettingsContext } from 'src/contexts/settings.context';
import { useWindowContext } from 'src/contexts/window.context';
import { useAppParams } from 'src/hooks/app-params.hook';
import { useNavigation } from 'src/hooks/navigation.hook';
import { Lnurl } from 'src/util/lnurl';
import { blankedAddress, formatLocationAddress, url } from 'src/util/utils';
import { Layout } from '../components/layout';

export interface PaymentStandard {
  id: PaymentStandardType | string;
  label: string;
  description: string;
  paymentIdentifierLabel?: string;
  blockchain?: Blockchain;
}

interface Quote {
  id: string;
  expiration: Date;
}

interface Amount {
  asset: string;
  amount: number;
}

export type TransferMethod = Blockchain;
export interface TransferInfo {
  method: TransferMethod;
  minFee: number;
  assets: Amount[];
}

export interface PaymentLinkPayTerminal {
  tag: string;
  displayName: string;
  standard: PaymentStandardType;
  possibleStandards: PaymentStandardType[];
  displayQr: boolean;
  recipient: {
    address?: {
      city: string;
      country: string;
      houseNumber: string;
      street: string;
      zip: string;
    };
    name?: string;
    mail?: string;
    phone?: string;
    website?: string;
  };

  // error fields
  statusCode?: number;
  message?: string;
  error?: string;
}

export interface PaymentLinkPayRequest extends PaymentLinkPayTerminal {
  quote: Quote;
  callback: string;
  metadata: string;
  minSendable: number;
  maxSendable: number;
  requestedAmount: Amount;
  transferAmounts: TransferInfo[];
}

interface FormData {
  paymentStandard: PaymentStandard;
  asset: string;
}

export default function PaymentLinkScreen(): JSX.Element {
  const { translate } = useSettingsContext();
  const { navigate } = useNavigation();
  const { lightning } = useAppParams();
  const { width } = useWindowContext();

  const [urlParams, setUrlParams] = useSearchParams();

  const [callbackUrl, setCallbackUrl] = useState<string>();
  const [payRequest, setPayRequest] = useState<PaymentLinkPayTerminal | PaymentLinkPayRequest>();
  const [paymentStandards, setPaymentStandards] = useState<PaymentStandard[]>();
  const [paymentIdentifier, setPaymentIdentifier] = useState<string>();
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>();

  const sessionApiUrl = useRef<string>(sessionStorage.getItem('apiUrl') ?? '');

  const setSessionApiUrl = (newUrl: string) => {
    sessionApiUrl.current = newUrl;
    sessionStorage.setItem('apiUrl', newUrl);
  };

  const {
    control,
    setValue,
    resetField,
    formState: { errors },
  } = useForm<FormData>({
    mode: 'onTouched',
  });

  const selectedPaymentMethod = useWatch({ control, name: 'paymentStandard' });
  const selectedEthereumUriAsset = useWatch({ control, name: 'asset' });

  useEffect(() => {
    const lightningParam = lightning;

    let apiUrl: string | undefined;
    if (lightningParam) {
      apiUrl = Lnurl.decode(lightningParam);
    } else if (urlParams.size) {
      apiUrl = `${process.env.REACT_APP_API_URL}/v1/paymentLink/payment?${urlParams.toString()}`;
    } else {
      apiUrl = sessionApiUrl.current;
    }

    if (!apiUrl) {
      urlParams.size ? setError('Invalid payment link.') : navigate('/', { replace: true });
      return;
    }

    if (apiUrl !== sessionApiUrl.current) setSessionApiUrl(apiUrl);

    if (urlParams.size) {
      const clearedParams = new URLSearchParams();
      setUrlParams(clearedParams);
    }
  }, []);

  useEffect(() => {
    if (!selectedPaymentMethod) {
      if (payRequest) setValue('paymentStandard', PaymentStandards[payRequest.standard]);
    } else {
      resetField('asset');
      const url = new URL(sessionApiUrl.current);
      const params = new URLSearchParams(url.search);
      if (params.get('standard') !== selectedPaymentMethod.id) {
        params.set('standard', selectedPaymentMethod.id);
        url.search = params.toString();
        setSessionApiUrl(url.toString());
      }
    }
  }, [selectedPaymentMethod, payRequest]);

  useEffect(() => {
    let refetchTimeout: NodeJS.Timeout | undefined;

    async function fetchPayRequest(url: string) {
      setError(undefined);
      return fetchDataApi(url)
        .then((data: PaymentLinkPayRequest | PaymentLinkPayTerminal) => {
          if (sessionApiUrl.current !== url) return;

          setPayRequest(data);
          setPaymentStandardsSelection(data);

          const expiration = hasQuote(data) && new Date(data.quote.expiration);
          const refetchDelay = expiration ? expiration.getTime() - Date.now() : 1000;
          refetchTimeout = setTimeout(() => fetchPayRequest(url), refetchDelay);
        })
        .catch((error: ApiError) => setError(error.message ?? 'Unknown Error'));
    }

    sessionApiUrl.current && fetchPayRequest(sessionApiUrl.current);

    return () => refetchTimeout && clearTimeout(refetchTimeout);
  }, [sessionApiUrl.current]);

  useEffect(() => {
    if (!payRequest || !hasQuote(payRequest)) return;

    let callback: string;
    switch (selectedPaymentMethod.id) {
      case PaymentStandardType.OPEN_CRYPTO_PAY:
      case PaymentStandardType.FRANKENCOIN_PAY:
        const lnurl = Lnurl.encode(simplifyUrl(sessionApiUrl.current));
        setPaymentIdentifier(Lnurl.prependLnurl(lnurl));
        break;
      case PaymentStandardType.LIGHTNING_BOLT11:
        callback = url(payRequest.callback, new URLSearchParams({ amount: payRequest.minSendable.toString() }));
        callback !== callbackUrl && setCallbackUrl(callback);
        break;
      default:
        const assets = payRequest.transferAmounts.find(
          (item) => item.method === selectedPaymentMethod?.blockchain,
        )?.assets;
        const asset = assets?.find((item) => item.asset === selectedEthereumUriAsset)?.asset ?? assets?.[0]?.asset;
        if (!asset) {
          setError('No asset found for this payment method');
          return;
        }
        callback = url(
          payRequest.callback,
          new URLSearchParams({
            quote: payRequest.quote.id,
            method: selectedPaymentMethod.blockchain?.toString() ?? '',
            asset,
          }),
        );
        callback !== callbackUrl && setCallbackUrl(callback);
        asset !== selectedEthereumUriAsset && setValue('asset', asset);
        break;
    }
  }, [payRequest, sessionApiUrl.current, selectedPaymentMethod, selectedEthereumUriAsset]);

  useEffect(() => {
    if (!callbackUrl) return;

    setIsLoading(true);
    setPaymentIdentifier(undefined);
    fetchDataApi(callbackUrl)
      .then((data) => data && setPaymentIdentifier(data.uri ?? data.pr))
      .catch((error) => setError(error.message))
      .finally(() => setIsLoading(false));
  }, [callbackUrl]);

  async function fetchDataApi(url: string): Promise<any> {
    const response = await fetch(url);
    return response.json();
  }

  function simplifyUrl(url: string): string {
    const replacementMap: { [key: string]: string } = {
      '/v1/paymentLink/payment': '/v1/plp',
      routeId: 'r',
      externalId: 'e',
      message: 'm',
      amount: 'a',
      currency: 'c',
      expiryDate: 'd',
    };

    const urlObj = new URL(url);
    const newPath = replacementMap[urlObj.pathname] || urlObj.pathname;
    const newParams = new URLSearchParams();
    urlObj.searchParams.forEach((value, key) => {
      const shortKey = replacementMap[key] || key;
      newParams.append(shortKey, value);
    });

    return `${urlObj.origin}${newPath}?${newParams.toString()}`;
  }

  function setPaymentStandardsSelection(request: PaymentLinkPayTerminal | PaymentLinkPayRequest): void {
    if (!hasQuote(request)) return;

    let standard: PaymentStandard | undefined;

    const possibleStandards =
      request?.possibleStandards.flatMap((type: PaymentStandardType) => {
        const paymentStandard = PaymentStandards[type];

        if (type !== PaymentStandardType.PAY_TO_ADDRESS) {
          if (request.standard === type) standard = paymentStandard;
          return paymentStandard;
        }

        return (hasQuote(request) ? request.transferAmounts : [])
          .filter((chain) => chain.method !== 'Lightning')
          .map((chain) => {
            const item = { ...paymentStandard, blockchain: chain.method };
            if (!standard) standard = item;
            return item;
          });
      }) ?? [];

    setPaymentStandards(possibleStandards);
    if (!selectedPaymentMethod && standard) setValue('paymentStandard', standard);
  }

  function hasQuote(request?: PaymentLinkPayTerminal | PaymentLinkPayRequest): request is PaymentLinkPayRequest {
    return !!request && 'quote' in request;
  }

  const assetsList =
    hasQuote(payRequest) &&
    payRequest.transferAmounts.find((item) => item.method === selectedPaymentMethod.blockchain)?.assets;

  return (
    <Layout backButton={false} smallMenu>
      {error ? (
        <ErrorHint message={error} />
      ) : !payRequest ? (
        <StyledLoadingSpinner size={SpinnerSize.LG} />
      ) : (
        <StyledVerticalStack full gap={4} center>
          <div className="flex flex-col w-full gap-6 py-8 justify-center">
            <p className="text-dfxBlue-800 font-bold text-xl">{payRequest.displayName}</p>
            <div className="w-full h-[1px] bg-gradient-to-r bg-dfxGray-500 from-white via-dfxGray-500 to-white" />
            {hasQuote(payRequest) ? (
              <p className="text-xl font-bold text-dfxBlue-800">
                <span className="text-[18px]">{payRequest.requestedAmount.asset} </span>
                {Utils.formatAmount(payRequest.requestedAmount.amount).replace('.00', '.-').replace(' ', "'")}
              </p>
            ) : (
              <div className="flex w-full justify-center">
                <StyledLoadingSpinner variant={SpinnerVariant.LIGHT_MODE} size={SpinnerSize.MD} />
              </div>
            )}
          </div>
          {!!paymentStandards?.length && (
            <Form control={control} errors={errors}>
              <StyledVerticalStack full gap={4} center>
                <StyledDropdown<PaymentStandard>
                  name="paymentStandard"
                  items={paymentStandards}
                  labelFunc={(item) =>
                    translate('screens/payment', item.label, { blockchain: item.blockchain?.toString() ?? '' })
                  }
                  descriptionFunc={(item) =>
                    translate('screens/payment', item.description, { blockchain: item.blockchain?.toString() ?? '' })
                  }
                  smallLabel
                  full
                />

                {assetsList && (
                  <StyledDropdown<string>
                    name="asset"
                    items={assetsList?.map((item) => item.asset) ?? []}
                    labelFunc={(item) => item}
                    descriptionFunc={() => selectedPaymentMethod.blockchain ?? ''}
                    full
                    smallLabel
                  />
                )}
              </StyledVerticalStack>
            </Form>
          )}
          <>
            <StyledCollapsible
              full
              titleContent={
                <div className="flex flex-col items-start gap-1.5 text-left -my-1">
                  <div className="flex flex-col items-start text-left">
                    <div className="font-semibold leading-none">{translate('screens/payment', 'Payment details')}</div>
                  </div>
                  <div className="leading-none text-dfxGray-800 text-xs">
                    {`${translate('screens/payment', 'Your payment details at a glance')}`}
                  </div>
                </div>
              }
            >
              <StyledDataTable alignContent={AlignContent.RIGHT} showBorder minWidth={false}>
                {hasQuote(payRequest) && (
                  <>
                    <StyledDataTableRow label={translate('screens/payment', 'State')}>
                      <p>{translate('screens/payment', 'Pending')}</p>
                    </StyledDataTableRow>

                    <StyledDataTableRow
                      label={selectedPaymentMethod.paymentIdentifierLabel}
                      isLoading={isLoading || !paymentIdentifier}
                    >
                      <p>{paymentIdentifier && blankedAddress(paymentIdentifier, { width, scale: 0.8 })}</p>
                      <CopyButton onCopy={() => paymentIdentifier && copy(paymentIdentifier)} />
                    </StyledDataTableRow>

                    <StyledDataTableRow label={translate('screens/payment', 'Amount')}>
                      <p>
                        {payRequest.requestedAmount.amount} {payRequest.requestedAmount.asset}
                      </p>
                    </StyledDataTableRow>
                  </>
                )}
                {payRequest.recipient && (
                  <StyledDataTableExpandableRow
                    label={translate('screens/payment', 'Recipient')}
                    expansionItems={
                      [
                        {
                          label: translate('screens/support', 'Name'),
                          text: payRequest.recipient.name,
                        },
                        {
                          label: translate('screens/home', 'Address'),
                          text: formatLocationAddress({ ...payRequest.recipient.address, country: undefined }) ?? '',
                        },
                        {
                          label: translate('screens/home', 'Country'),
                          text: payRequest.recipient.address?.country ?? '',
                        },
                        {
                          label: translate('screens/kyc', 'Phone number'),
                          text: payRequest.recipient.phone,
                        },
                        {
                          label: translate('screens/kyc', 'Email address'),
                          text: payRequest.recipient.mail,
                        },
                        {
                          label: translate('screens/kyc', 'Website'),
                          text: payRequest.recipient.website,
                          onClick: () => {
                            const url =
                              payRequest.recipient.website?.startsWith('http://') ||
                              payRequest.recipient.website?.startsWith('https://')
                                ? payRequest.recipient.website
                                : `https://${payRequest.recipient.website}`;

                            window.open(url, '_blank');
                          },
                        },
                      ].filter((item) => item.text) as any
                    }
                  />
                )}
                {hasQuote(payRequest) && !payRequest.displayQr && (
                  <StyledDataTableExpandableRow
                    label={translate('screens/payment', 'QR Code')}
                    expansionContent={
                      <div className="flex w-full items-center justify-center">
                        <div className="w-48 my-3">
                          <QrBasic data={paymentIdentifier ?? ''} isLoading={isLoading || !paymentIdentifier} />
                        </div>
                      </div>
                    }
                  />
                )}
              </StyledDataTable>
            </StyledCollapsible>
            {[PaymentStandardType.OPEN_CRYPTO_PAY, PaymentStandardType.FRANKENCOIN_PAY].includes(
              selectedPaymentMethod?.id as PaymentStandardType,
            ) && (
              <StyledVerticalStack full gap={8} center>
                {hasQuote(payRequest) && (
                  <div className="flex flex-col w-full items-center justify-center">
                    {payRequest.displayQr && (
                      <div className="w-48 my-3">
                        <QrBasic data={paymentIdentifier ?? ''} isLoading={isLoading || !paymentIdentifier} />
                      </div>
                    )}
                    <p className="text-base pt-3 text-dfxGray-700">
                      {translate(
                        'screens/payment',
                        'Scan the QR-Code with a compatible wallet to complete the payment.',
                      )}
                    </p>
                  </div>
                )}
                <WalletGrid wallets={RecommendedWallets} header={translate('screens/payment', 'Recommended wallets')} />
                <WalletGrid header={translate('screens/payment', 'Other compatible wallets')} />
              </StyledVerticalStack>
            )}
          </>
        </StyledVerticalStack>
      )}
    </Layout>
  );
}

interface WalletGridProps {
  wallets?: string[];
  header?: string;
}

function WalletGrid({ wallets, header }: WalletGridProps): JSX.Element {
  const walletNames = wallets ?? Object.keys(CompatibleWallets);

  return (
    <div className="flex flex-col w-full gap-4 px-4">
      {header && (
        <div className="flex flex-row items-center gap-2">
          <div className="flex-grow bg-gradient-to-r from-white to-dfxGray-600 h-[1px]" />
          <p className="text-xs font-medium text-dfxGray-600 whitespace-nowrap">{header.toUpperCase()}</p>
          <div className="flex-grow bg-gradient-to-r from-dfxGray-600 to-white h-[1px]" />
        </div>
      )}
      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(60px, 1fr))' }}>
        {walletNames.map((walletName) => {
          const wallet = CompatibleWallets[walletName];

          return (
            <div
              key={walletName}
              className="flex flex-col items-center gap-2 cursor-pointer max-w-[120px] min-w-0"
              onClick={() => window.open(wallet.websiteUrl)}
            >
              <img
                className="border border-dfxGray-400 shadow-md bg-white rounded-md"
                src={wallet.iconUrl}
                alt={walletName}
              />
              <p className="text-center font-semibold text-dfxGray-600 w-full text-xs truncate">{walletName}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

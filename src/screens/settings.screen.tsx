import { Fiat, Language, useFiatContext, UserAddress, useUserContext } from '@dfx.swiss/react';
import {
  AlignContent,
  DfxIcon,
  Form,
  IconColor,
  IconVariant,
  SpinnerSize,
  StyledButton,
  StyledDataTable,
  StyledDataTableRow,
  StyledDropdown,
  StyledLoadingSpinner,
  StyledVerticalStack,
} from '@dfx.swiss/react-components';
import copy from 'copy-to-clipboard';
import { useEffect, useRef, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { Trans } from 'react-i18next';
import { Layout } from 'src/components/layout';
import { ConfirmationOverlay, RenameAddressOverlay } from 'src/components/overlays';
import { useSettingsContext } from 'src/contexts/settings.context';
import { useWalletContext } from 'src/contexts/wallet.context';
import { useWindowContext } from 'src/contexts/window.context';
import { useUserGuard } from 'src/hooks/guard.hook';
import { blankedAddress, sortAddressesByBlockchain } from 'src/util/utils';

interface FormData {
  language: Language;
  currency: Fiat;
}

enum OverlayType {
  NONE,
  DELETE_ADDRESS,
  DELETE_ACCOUNT,
  RENAME_ADDRESS,
}

const OverlayHeader: { [key in OverlayType]: string } = {
  [OverlayType.NONE]: '',
  [OverlayType.DELETE_ADDRESS]: 'Delete wallet',
  [OverlayType.DELETE_ACCOUNT]: 'Delete account',
  [OverlayType.RENAME_ADDRESS]: 'Rename wallet',
};

export default function SettingsScreen(): JSX.Element {
  const { translate, language, currency, availableLanguages, changeLanguage, changeCurrency } = useSettingsContext();
  const { currencies } = useFiatContext();
  const { user, isUserLoading } = useUserContext();
  const { setWallet } = useWalletContext();
  const { width } = useWindowContext();
  const { deleteAddress, deleteAccount, renameAddress } = useUserContext();

  const rootRef = useRef<HTMLDivElement>(null);

  const [menuAddress, setMenuAddress] = useState<UserAddress>();
  const [showDisabledWallets, setShowDisabledWallets] = useState(false);
  const [overlayType, setOverlayType] = useState<OverlayType>(OverlayType.NONE);

  useUserGuard('/login');

  const {
    control,
    setValue,
    formState: { errors },
  } = useForm<FormData>();
  const selectedLanguage = useWatch({ control, name: 'language' });
  const selectedCurrency = useWatch({ control, name: 'currency' });

  useEffect(() => {
    if (language && !selectedLanguage) setValue('language', language);
  }, [language]);

  useEffect(() => {
    if (currency && !selectedCurrency) setValue('currency', currency);
  }, [currency]);

  useEffect(() => {
    if (selectedLanguage && selectedLanguage?.id !== language?.id) {
      changeLanguage(selectedLanguage);
    }
  }, [selectedLanguage]);

  useEffect(() => {
    if (selectedCurrency && selectedCurrency?.id !== currency?.id) {
      changeCurrency(selectedCurrency);
    }
  }, [selectedCurrency]);

  async function onCloseOverlay(result?: any): Promise<void> {
    if (result) {
      switch (overlayType) {
        case OverlayType.DELETE_ADDRESS:
          if (!menuAddress) break;
          deleteAddress(menuAddress.address);
          menuAddress.address === user?.activeAddress?.address && setWallet();
          break;
        case OverlayType.DELETE_ACCOUNT:
          deleteAccount();
          setWallet();
          break;
        case OverlayType.RENAME_ADDRESS:
          if (!menuAddress) break;
          await renameAddress(menuAddress.address, result);
          break;
      }
    }

    setOverlayType(OverlayType.NONE);
    setMenuAddress(undefined);
  }

  const title = OverlayHeader[overlayType]
    ? `${translate('general/actions', OverlayHeader[overlayType])}?`
    : translate('screens/settings', 'Settings');

  const userAddresses = user?.addresses.sort(sortAddressesByBlockchain);
  const disabledAddresses = showDisabledWallets ? user?.disabledAddresses.sort(sortAddressesByBlockchain) : [];
  const addressesList = (userAddresses ?? []).concat(disabledAddresses ?? []);

  return (
    <Layout title={title} rootRef={rootRef} onBack={overlayType ? () => onCloseOverlay() : undefined}>
      {overlayType ? (
        <SettingsOverlay type={overlayType} address={menuAddress} onClose={onCloseOverlay} />
      ) : (
        <StyledVerticalStack full gap={8}>
          <StyledVerticalStack full gap={4}>
            <Form control={control} errors={errors}>
              <StyledDropdown
                name="language"
                label={translate('screens/settings', 'Language')}
                smallLabel={true}
                placeholder={translate('general/actions', 'Select...')}
                items={availableLanguages}
                labelFunc={(item) => item.name}
                descriptionFunc={(item) => item.foreignName}
              />
            </Form>

            <Form control={control} errors={errors}>
              <StyledDropdown
                name="currency"
                label={translate('screens/settings', 'Currency')}
                smallLabel={true}
                placeholder={translate('general/actions', 'Select...')}
                items={currencies ?? []}
                labelFunc={(item) => item.name}
              />
            </Form>
          </StyledVerticalStack>

          {isUserLoading ? (
            <div className="flex mt-4 w-full justify-center items-center">
              <StyledLoadingSpinner size={SpinnerSize.LG} />
            </div>
          ) : (
            <>
              {addressesList?.length ? (
                <StyledVerticalStack full gap={2}>
                  <StyledDataTable
                    label={translate('screens/settings', 'Your Wallets')}
                    alignContent={AlignContent.BETWEEN}
                  >
                    {addressesList.map((address) => {
                      const isDisabled = (user as any)?.disabledAddresses.some(
                        (disabledAddress: UserAddress) => disabledAddress.address === address.address,
                      );

                      return (
                        <StyledDataTableRow key={address.address}>
                          <div className="flex flex-col items-start gap-1">
                            <div
                              className={`flex flex-row gap-2 font-semibold ${isDisabled ? 'text-dfxGray-700' : ''}`}
                            >
                              {address.label ?? address.wallet}
                              {address.address === user?.activeAddress?.address && (
                                <div className="flex bg-dfxGray-400 font-bold rounded-sm px-1.5 text-2xs items-center justify-center">
                                  {translate('screens/settings', 'Active').toUpperCase()}
                                </div>
                              )}
                            </div>
                            <div className="text-xs text-dfxGray-700">{blankedAddress(address.address, { width })}</div>
                          </div>
                          <div className="relative flex items-center">
                            <button onClick={() => setMenuAddress(address)}>
                              <DfxIcon icon={IconVariant.THREE_DOTS_VERT} color={IconColor.BLUE} />
                            </button>
                            {menuAddress?.address === address.address && (
                              <OverflowMenu
                                menuItems={[
                                  {
                                    label: translate('general/actions', 'Copy'),
                                    onClick: () => {
                                      copy(address.address);
                                      setMenuAddress(undefined);
                                    },
                                  },
                                  {
                                    label: translate('general/actions', 'Open Explorer'),
                                    onClick: () => {
                                      window.open(address.explorerUrl, '_blank');
                                      setMenuAddress(undefined);
                                    },
                                  },
                                  {
                                    label: translate('general/actions', 'Rename'),
                                    onClick: () => setOverlayType(OverlayType.RENAME_ADDRESS),
                                    hidden: isDisabled,
                                  },
                                  {
                                    label: translate('general/actions', 'Delete'),
                                    onClick: () => setOverlayType(OverlayType.DELETE_ADDRESS),
                                    hidden: isDisabled,
                                  },
                                ]}
                                onClose={() => setMenuAddress(undefined)}
                              />
                            )}
                          </div>
                        </StyledDataTableRow>
                      );
                    })}
                    <StyledDataTableRow>
                      <div
                        className="flex flex-row w-full justify-between items-start gap-1 text-xs cursor-pointer select-none text-dfxGray-700 hover:text-dfxGray-800"
                        onClick={() => setShowDisabledWallets((prev) => !prev)}
                      >
                        <div>
                          {showDisabledWallets
                            ? translate('screens/settings', 'Hide deleted wallets')
                            : translate('screens/settings', 'Show deleted wallets')}
                        </div>
                        <DfxIcon
                          icon={showDisabledWallets ? IconVariant.EXPAND_LESS : IconVariant.EXPAND_MORE}
                          color={IconColor.DARK_GRAY}
                        />
                      </div>
                    </StyledDataTableRow>
                  </StyledDataTable>
                </StyledVerticalStack>
              ) : (
                <></>
              )}
              <StyledButton
                label={translate('general/actions', 'Delete account')}
                onClick={() => setOverlayType(OverlayType.DELETE_ACCOUNT)}
              />
            </>
          )}
        </StyledVerticalStack>
      )}
    </Layout>
  );
}

interface MenuItem {
  label: string;
  hidden?: boolean;
  onClick: () => void;
}

interface OverflowMenuProps {
  menuItems: MenuItem[];
  onClose: () => void;
}

function OverflowMenu({ menuItems, onClose }: OverflowMenuProps): JSX.Element {
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (document) {
      function closeMenu(event: Event) {
        if (!menuRef.current?.contains(event.target as Node)) {
          onClose();
        }
      }

      document.addEventListener('mousedown', closeMenu);
      return () => document.removeEventListener('mousedown', closeMenu);
    }
  }, []);

  return (
    <div
      ref={menuRef}
      className="absolute right-5 top-3 border border-dfxGray-400 shadow-md z-10 bg-white rounded-md overflow-clip"
    >
      <div className="flex flex-col divide-y-0.5 divide-dfxGray-400 items-start bg-dfxGray-100 w-36">
        {menuItems
          .filter((item) => !item.hidden)
          .map((item) => (
            <button
              key={item.label}
              className="hover:bg-dfxGray-300 w-full text-left px-4 py-2"
              onClick={(e) => {
                e.stopPropagation();
                item.onClick();
              }}
            >
              {item.label}
            </button>
          ))}
      </div>
    </div>
  );
}

interface SettingsOverlayProps {
  type: OverlayType;
  address?: UserAddress;
  onClose: (result?: any) => Promise<void>;
}

function SettingsOverlay({ type, address, onClose }: SettingsOverlayProps): JSX.Element {
  const { width } = useWindowContext();
  const { translate } = useSettingsContext();

  switch (type) {
    case OverlayType.DELETE_ADDRESS:
      const formattedAddress = blankedAddress(address?.address ?? '', { width });

      return (
        <ConfirmationOverlay
          messageContent={
            <p className="text-dfxBlue-800 mb-2">
              <Trans i18nKey="screens/settings.delete" values={{ address: formattedAddress }}>
                Are you sure you want to delete the address <strong>{formattedAddress}</strong> from your DFX account?
                This action is irreversible.
              </Trans>
            </p>
          }
          cancelLabel={translate('general/actions', 'Cancel')}
          confirmLabel={translate('general/actions', 'Delete')}
          onCancel={() => onClose(false)}
          onConfirm={() => onClose(true)}
        />
      );
    case OverlayType.DELETE_ACCOUNT:
      return (
        <ConfirmationOverlay
          message={translate(
            'screens/settings',
            'Your data will remain on our servers temporarily before permanent deletion. If you have any questions, please contact our support team.',
          )}
          cancelLabel={translate('general/actions', 'Cancel')}
          confirmLabel={translate('general/actions', 'Delete')}
          onCancel={() => onClose(false)}
          onConfirm={() => onClose(true)}
        />
      );
    case OverlayType.RENAME_ADDRESS:
      return <RenameAddressOverlay placeholder={address?.label ?? address?.wallet} onClose={onClose} />;
    default:
      return <></>;
  }
}

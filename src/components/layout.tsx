import { PropsWithChildren, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useParamContext } from '../contexts/param.context';
import { GeneralLinks } from './general-links';
import { Navigation } from './navigation';

interface LayoutProps extends PropsWithChildren {
  title?: string;
  backButton?: boolean;
  textStart?: boolean;
}

export function Layout({ title, backButton, textStart, children }: LayoutProps): JSX.Element {
  const { search } = useLocation();
  const { init } = useParamContext();

  useEffect(() => {
    init(search);
  }, [search]);

  return (
    <>
      <Navigation title={title} backButton={backButton} />

      <div className="flex flex-grow justify-center">
        <div
          className={`max-w-screen-md flex flex-grow flex-col items-center ${
            textStart ? 'text-start' : 'text-center'
          } px-5 py-2 mt-4 gap-2`}
        >
          {children}
        </div>
      </div>

      <GeneralLinks />
    </>
  );
}

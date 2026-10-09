import { createContext, useContext } from 'react';

/**
 * What Administration's About holds beside the version: the scaffolding's environment panel and the
 * delivery line, which the application shell knows and the workspace does not.
 */
export const AboutContext = createContext<React.ReactNode>(null);

export const useAbout = () => useContext(AboutContext);

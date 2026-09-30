/** Product name shown in the interface. Change it here only (BRD section 3.1). */
export const PRODUCT_NAME = "Decision-Maker Intelligence";

/** Where the app is mounted behind the BEAM reverse proxy (BRD section 3.1). */
export const APP_BASE_PATH = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? process.env.APP_BASE_PATH ?? "/intelligence";

/** The brand lockup links to the BEAM home, which lives outside APP_BASE_PATH. */
export const BEAM_HOME_URL = "/";

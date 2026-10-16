import { getBranding } from '../../shared/branding';

const branding = getBranding();

export const APP_NAME = branding.productName;
export const APP_ID = branding.appId;
export const EXPORT_FORMAT_TYPE = `${branding.appId}.providers`;
export const EXPORT_PASSWORD = `${branding.appId}-APP`;

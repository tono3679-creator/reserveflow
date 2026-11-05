/** Cookie の名前と形（proxy.ts からも読むため、サーバー専用の処理は含めない） */
export const SESSION_COOKIE = "rf_session";
/** 32バイトを base64url にした形。形の違う値は DB に問い合わせない */
export const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
/** 選択中の店舗（値は店舗 ID。アクセスできるかは毎回サーバーで確かめる） */
export const LOCATION_COOKIE = "rf_location";

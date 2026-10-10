// Stand-in for expo-auth-session: no OAuth in stories.
export const makeRedirectUri = () => "vamovirar://oauth";
export const useAuthRequest = () => [null, null, async () => null] as const;
export const exchangeCodeAsync = async () => ({ accessToken: "", expiresIn: 3600 });

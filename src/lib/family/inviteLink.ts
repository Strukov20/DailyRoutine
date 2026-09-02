import * as Linking from 'expo-linking';

/**
 * Builds the deep link shared via native Share sheet or copy-link for a
 * family invitation (familyflow://invite/<token>) — routes to
 * app/invite/[token].tsx. There is no email provider this phase (see
 * docs/DECISIONS.md), so this link is the entire delivery mechanism: the
 * owner shares it through whatever channel they like.
 */
export function makeInviteLink(token: string): string {
  return Linking.createURL(`invite/${token}`);
}

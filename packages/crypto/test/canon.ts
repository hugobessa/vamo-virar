import { canonicalJson, type CommunityState } from "@vamo-virar/domain";

/** State equality across devices, ignoring the device-local op_id index. */
export function canonState(s: CommunityState): string {
  const { op_ids: _ignored, ...rest } = s;
  return canonicalJson(rest);
}

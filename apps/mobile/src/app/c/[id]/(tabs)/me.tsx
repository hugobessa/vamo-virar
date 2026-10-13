// "Eu": this person in the community.

import { CommunityTab } from "../../../../ui/community/CommunityTab";
import { MeTab } from "../../../../ui/community/MeTab";

export default function MeRoute() {
  return <CommunityTab>{(entry) => <MeTab entry={entry} />}</CommunityTab>;
}

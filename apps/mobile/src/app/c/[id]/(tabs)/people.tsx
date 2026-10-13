// "Pessoas": who is in the community.

import { CommunityTab } from "../../../../ui/community/CommunityTab";
import { PeopleTab } from "../../../../ui/community/PeopleTab";

export default function PeopleRoute() {
  return <CommunityTab>{(entry) => <PeopleTab entry={entry} />}</CommunityTab>;
}

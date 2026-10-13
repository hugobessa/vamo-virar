// "Ações": the community's actions, with the way to its WhatsApp group on top.

import { Actions } from "../../../../ui/kit";
import { CommunityTab } from "../../../../ui/community/CommunityTab";
import { EventsTab } from "../../../../ui/community/EventsTab";
import { WhatsAppButton } from "../../../../ui/WhatsApp";

export default function EventsRoute() {
  return (
    <CommunityTab>
      {(entry) => (
        <>
          {entry.replica.view?.community.whatsapp ? (
            <Actions>
              <WhatsAppButton testID="community-whatsapp-open" link={entry.replica.view.community.whatsapp} />
            </Actions>
          ) : null}
          <EventsTab entry={entry} />
        </>
      )}
    </CommunityTab>
  );
}

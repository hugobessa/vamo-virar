// "Tarefas": the board.

import { CommunityTab } from "../../../../ui/community/CommunityTab";
import { TasksTab } from "../../../../ui/community/TasksTab";

export default function TasksRoute() {
  return <CommunityTab>{(entry) => <TasksTab entry={entry} />}</CommunityTab>;
}

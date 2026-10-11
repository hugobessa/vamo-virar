// One task: what it is, who is on it, the one thing this person most likely
// wants to do next, and the conversation under it. Everything else sits in
// the "⋯" menu, so the conversation is never pushed off the screen.

import type { TaskStatus } from "@vamo-virar/domain";
import { toHex } from "@vamo-virar/protocol";
import * as ExpoCrypto from "expo-crypto";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { confirm } from "../../../../lib/confirm";
import { useApp, useCommunity, useNow } from "../../../../lib/context";
import { fill } from "../../../../model/i18n";
import { toggleCheck } from "../../../../model/markdown";
import {
  canComment,
  canDeleteComment,
  canEdit,
  canManage,
  canRemove,
  isOpen,
  lastSeq,
  scopeTitle,
  SELF_ACTION_TEXT,
  selfActions,
  STATUS_ORDER,
  STATUS_TEXT,
  statusTargets,
  timeline,
  type SelfAction,
} from "../../../../model/tasks";
import { DisabledScope } from "../../../../ui/community/Disabled";
import { Body, Button, Card, Chip, Enter, Field, Heading, MenuItem, MoreButton, Screen, Sheet, Title } from "../../../../ui/kit";
import { Markdown } from "../../../../ui/Markdown";
import { AttachmentList } from "../../../../ui/tasks/Attachments";
import { ChecklistProgress, Choices, DueLine, Label, nameOf, PeopleSheet, PriorityChip, StatusChip, Tags } from "../../../../ui/tasks/TaskBits";
import { fonts, space, useTheme } from "../../../../ui/theme";

/** Statuses offered in the "Situação" row while someone is on the task; cancelling lives in the menu. */
const WORKING: readonly TaskStatus[] = ["todo", "in_progress", "blocked", "done"];

export default function TaskScreen() {
  const { id, tid } = useLocalSearchParams<{ id: string; tid: string }>();
  const { t, store } = useApp();
  const c = useTheme();
  const now = useNow();
  const entry = useCommunity(id);
  const [pending, setPending] = useState<TaskStatus | null>(null);
  const [note, setNote] = useState("");
  const [comment, setComment] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [menu, setMenu] = useState(false);
  const [commentMenu, setCommentMenu] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);
  const state = entry?.replica.view;
  const task = state?.tasks?.[tid ?? ""];

  // Looking at the task is what clears its news; new activity while it is open is seen too.
  const seq = task ? lastSeq(task) : 0;
  useEffect(() => {
    if (entry && task) store.markTaskSeen(entry.id, task.task_id, seq);
  }, [store, entry, task, seq]);

  if (!entry || !state || !task) {
    return (
      <Screen>
        <Body muted>{t("why_unknown_target")}</Body>
      </Screen>
    );
  }
  const me = state.members[entry.replica.memberId];
  const manager = canManage(state, task, me);
  const open = isOpen(task);
  const on = !!me && (task.assignee === me.member_id || task.volunteers.includes(me.member_id));
  const submit = (type: string, body: Record<string, unknown>) => store.submit(entry.id, type, { task_id: task.task_id, ...body } as never);
  const scope = scopeTitle(state, task);
  const self = selfActions(state, task, me);
  const targets = statusTargets(state, task, me);
  const items = timeline(task);
  const editable = canEdit(state, task, me);

  const selfLabel = (a: SelfAction) => {
    if (a === "take" && task.assignee !== undefined) return t("taskTakeOver");
    if (a === "unassign" && task.assignee !== me?.member_id) return t("taskClearAssignee");
    return t(SELF_ACTION_TEXT[a]);
  };
  const selfOp: Record<SelfAction, string> = { take: "task.assign", unassign: "task.unassign", join: "task.join", leave: "task.leave" };
  const statusName = (s: TaskStatus) => t(STATUS_TEXT[s]).toLowerCase();

  const choose = (s: TaskStatus) => {
    setNote("");
    setPending(s === task.status || s === pending ? null : s);
  };
  const confirmStatus = () => {
    if (!pending) return;
    submit("task.status", { status: pending, ...(note.trim() ? { note: note.trim() } : {}) });
    setPending(null);
    setNote("");
  };

  // The one big button: take a waiting task, finish yours, offer help, or reopen.
  type Primary = { label: string; testID: string; run: () => void; kind?: "primary" | "secondary" };
  let primary: Primary | null = null;
  let primaryAction: SelfAction | "done" | "reopen" | null = null;
  if (!open) {
    const back = targets[0];
    if (back) {
      primary = { label: t("taskReopenAction"), testID: `status-${back}`, kind: "secondary", run: () => submit("task.status", { status: back }) };
      primaryAction = "reopen";
    }
  } else if (task.assignee === undefined && self.includes("take")) {
    primary = { label: t("taskTake"), testID: "self-take", run: () => submit("task.assign", {}) };
    primaryAction = "take";
  } else if (on && targets.includes("done")) {
    primary = { label: t("taskMarkDone"), testID: "mark-done", run: () => choose("done") };
    primaryAction = "done";
  } else if (self.includes("join")) {
    primary = { label: t("taskJoin"), testID: "self-join", kind: "secondary", run: () => submit("task.join", {}) };
    primaryAction = "join";
  }

  // The "Situação" row, for whoever is on it or manages it once someone is responsible.
  const statusRow = open && task.assignee !== undefined && (on || manager) ? WORKING.filter((s) => s === task.status || targets.includes(s)) : [];
  const people = Object.values(state.members)
    .filter((m) => m.status === "active" && m.member_id !== task.assignee)
    .sort((a, b) => (a.profile?.display_name ?? "").localeCompare(b.profile?.display_name ?? ""));

  // Everything else, in the menu.
  const menuItems: { key: string; label: string; danger?: boolean; run: () => void }[] = [];
  if (editable) menuItems.push({ key: "edit-task", label: t("editTask"), run: () => router.push({ pathname: "/c/[id]/task-form", params: { id: entry.id, tid: task.task_id } }) });
  for (const a of self) if (a !== primaryAction) menuItems.push({ key: `self-${a}`, label: selfLabel(a), run: () => submit(selfOp[a], {}) });
  if (manager && open) menuItems.push({ key: "assign-other", label: t("taskAssignOther"), run: () => setAssigning(true) });
  if (open && statusRow.length === 0 && primaryAction !== "done" && targets.includes("done")) menuItems.push({ key: "status-done", label: t("taskMarkDone"), run: () => choose("done") });
  if (targets.includes("cancelled")) {
    menuItems.push({
      key: "status-cancelled",
      label: t("taskCancelTask"),
      danger: true,
      run: async () => {
        if (await confirm(t("taskCancelConfirm"), t("yes"), t("no"))) submit("task.status", { status: "cancelled" });
      },
    });
  }
  if (canRemove(state, task, me)) {
    menuItems.push({
      key: "remove-task",
      label: t("taskRemove"),
      danger: true,
      run: async () => {
        if (!(await confirm(t("taskRemoveConfirm"), t("yes"), t("no")))) return;
        submit("task.remove", {});
        router.back();
      },
    });
  }

  const menuComment = task.comments.find((x) => x.comment_id === commentMenu);

  return (
    <Screen>
      <Stack.Screen options={{ title: t("taskScreenTitle") }} />
      <DisabledScope entry={entry}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.s }}>
          <View style={{ flex: 1 }}>
            <Title caps={false}>{task.title}</Title>
          </View>
          {menuItems.length > 0 ? <MoreButton testID="task-menu" label={t("taskMore")} onPress={() => setMenu(true)} /> : null}
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s }}>
          <StatusChip status={task.status} />
          <PriorityChip priority={task.priority} />
        </View>
        {scope && task.event_id ? (
          <Text
            accessibilityRole="link"
            style={{ color: c.primary, fontFamily: fonts.text, fontSize: 15, fontWeight: "600" }}
            onPress={() => router.push({ pathname: "/c/[id]/event/[eid]", params: { id: entry.id, eid: task.event_id! } })}
          >
            {scope}
          </Text>
        ) : null}
        <DueLine task={task} now={now} />
        <Tags tags={task.tags} />
        {task.description ? (
          <Markdown testID="task-description" source={task.description} onToggle={editable ? (line) => submit("task.update", { description: toggleCheck(task.description, line) }) : undefined} />
        ) : null}
        <ChecklistProgress source={task.description} />
        <AttachmentList entry={entry} attachments={task.attachments} />

        <Card>
          <Label>{t("taskAssignedTo")}</Label>
          <Body>{task.assignee !== undefined ? nameOf(state, task.assignee, "?") : t("taskNobodyYet")}</Body>
          {task.volunteers.length > 0 ? (
            <>
              <Label>{t("taskHelpers")}</Label>
              <Body>{task.volunteers.map((v) => nameOf(state, v, "?")).join(", ")}</Body>
            </>
          ) : null}
        </Card>

        {primary && pending === null ? <Button testID={primary.testID} kind={primary.kind ?? "primary"} haptic={primaryAction === "take" ? "confirm" : "light"} label={primary.label} onPress={primary.run} /> : null}

        {statusRow.length > 1 ? (
          <View style={{ gap: space.xs }}>
            <Label>{t("taskStatusLabel")}</Label>
            <Choices<TaskStatus>
              testID="status"
              value={pending ?? task.status}
              onChange={choose}
              options={[...statusRow].sort((a, b) => STATUS_ORDER.indexOf(a) - STATUS_ORDER.indexOf(b)).map((s) => ({ value: s, label: t(STATUS_TEXT[s]) }))}
            />
          </View>
        ) : null}
        {pending ? (
          <Enter>
            <Card>
              <Field testID="status-note" label={t("taskNoteOptional")} value={note} onChangeText={setNote} />
              <Button testID="status-confirm" haptic={pending === "done" ? "confirm" : "light"} label={fill(t("taskConfirmStatus"), { status: statusName(pending) })} onPress={confirmStatus} />
              <Button kind="secondary" compact label={t("cancel")} onPress={() => setPending(null)} />
            </Card>
          </Enter>
        ) : null}

        <Heading>{t("taskComments")}</Heading>
        {items.map((item) =>
          item.kind === "status" ? (
            <Text key={`s${item.seq}`} style={{ color: c.muted, fontFamily: fonts.text, fontSize: 14 }}>
              {item.seq === task.created_seq
                ? `${nameOf(state, item.change.by, "?")} ${t("taskCreatedBy")}`
                : `${nameOf(state, item.change.by, "?")} ${t("taskStatusChanged")} ${statusName(item.change.status)}${item.change.note ? `: ${item.change.note}` : ""}`}
            </Text>
          ) : (
            <Card key={item.comment.comment_id} testID={`comment-${item.comment.comment_id.slice(0, 8)}`}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.s }}>
                <Text style={{ flex: 1, color: c.text, fontFamily: fonts.text, fontSize: 15, fontWeight: "700" }}>{nameOf(state, item.comment.author, "?")}</Text>
                {item.comment.edited_seq !== undefined ? <Chip label={t("taskCommentEdited")} /> : null}
                {editing !== item.comment.comment_id && (item.comment.author === me?.member_id || canDeleteComment(state, task, item.comment, me)) ? (
                  <MoreButton label={t("taskCommentActions")} onPress={() => setCommentMenu(item.comment.comment_id)} />
                ) : null}
              </View>
              {editing === item.comment.comment_id ? (
                <>
                  <Field label={t("taskCommentEdit")} value={editText} onChangeText={setEditText} multiline />
                  <Button
                    label={t("save")}
                    disabled={!editText.trim() || editText.trim() === item.comment.body}
                    onPress={() => {
                      submit("task.comment_edit", { comment_id: item.comment.comment_id, body: editText.trim() });
                      setEditing(null);
                    }}
                  />
                  <Button kind="secondary" compact label={t("cancel")} onPress={() => setEditing(null)} />
                </>
              ) : (
                <Markdown source={item.comment.body} />
              )}
            </Card>
          ),
        )}
        {canComment(state, task, me) ? (
          <>
            <Field testID="comment-text" label={t("taskCommentNew")} placeholder={t("taskCommentPlaceholder")} value={comment} onChangeText={setComment} multiline />
            <Button
              testID="comment-send"
              kind="secondary"
              label={t("taskCommentSend")}
              disabled={!comment.trim()}
              onPress={() => {
                submit("task.comment", { comment_id: toHex(ExpoCrypto.getRandomBytes(16)), body: comment.trim() });
                setComment("");
              }}
            />
          </>
        ) : null}

        <Sheet visible={menu} onClose={() => setMenu(false)} title={task.title} testID="task-menu-sheet">
          {menuItems.map((m) => (
            <MenuItem
              key={m.key}
              testID={m.key}
              label={m.label}
              danger={m.danger}
              onPress={() => {
                setMenu(false);
                m.run();
              }}
            />
          ))}
        </Sheet>
        <Sheet visible={!!menuComment} onClose={() => setCommentMenu(null)} title={t("taskCommentActions")}>
          {menuComment && menuComment.author === me?.member_id ? (
            <MenuItem
              testID="comment-edit"
              label={t("taskCommentEdit")}
              onPress={() => {
                setEditing(menuComment.comment_id);
                setEditText(menuComment.body);
                setCommentMenu(null);
              }}
            />
          ) : null}
          {menuComment && canDeleteComment(state, task, menuComment, me) ? (
            <MenuItem
              testID="comment-delete"
              danger
              label={t("taskCommentDelete")}
              onPress={() => {
                submit("task.comment_delete", { comment_id: menuComment.comment_id });
                setCommentMenu(null);
              }}
            />
          ) : null}
        </Sheet>
        <PeopleSheet
          visible={assigning}
          onClose={() => setAssigning(false)}
          title={t("taskAssignOther")}
          people={people}
          value={null}
          me={me?.member_id}
          testID="assign"
          onPick={(v) => {
            if (v) submit("task.assign", { member_id: v });
            setAssigning(false);
          }}
        />
      </DisabledScope>
    </Screen>
  );
}

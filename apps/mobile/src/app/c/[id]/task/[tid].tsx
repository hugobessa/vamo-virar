// One task: what it is, who is on it, what this person can do about it, and
// the conversation under it.

import { toHex } from "@vamo-virar/protocol";
import * as ExpoCrypto from "expo-crypto";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import { confirm } from "../../../../lib/confirm";
import { useApp, useCommunity, useNow } from "../../../../lib/context";
import {
  canComment,
  canDeleteComment,
  canEdit,
  canManage,
  canRemove,
  isOpen,
  scopeTitle,
  SELF_ACTION_TEXT,
  selfActions,
  STATUS_TEXT,
  statusTargets,
  timeline,
  type SelfAction,
} from "../../../../model/tasks";
import { DisabledScope } from "../../../../ui/community/Disabled";
import { Body, Button, Card, Chip, Enter, Field, Heading, Screen, Title } from "../../../../ui/kit";
import { Markdown } from "../../../../ui/Markdown";
import { AttachmentList } from "../../../../ui/tasks/Attachments";
import { DueLine, Label, nameOf, PriorityChip, StatusChip, Tags } from "../../../../ui/tasks/TaskBits";
import { fonts, space, useTheme } from "../../../../ui/theme";

export default function TaskScreen() {
  const { id, tid } = useLocalSearchParams<{ id: string; tid: string }>();
  const { t, store } = useApp();
  const c = useTheme();
  const now = useNow();
  const entry = useCommunity(id);
  const [note, setNote] = useState("");
  const [comment, setComment] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [assigning, setAssigning] = useState(false);
  const state = entry?.replica.view;
  const task = state?.tasks?.[tid ?? ""];
  if (!entry || !state || !task) {
    return (
      <Screen>
        <Body muted>{t("why_unknown_target")}</Body>
      </Screen>
    );
  }
  const me = state.members[entry.replica.memberId];
  const manager = canManage(state, task, me);
  const submit = (type: string, body: Record<string, unknown>) => store.submit(entry.id, type, { task_id: task.task_id, ...body } as never);
  const scope = scopeTitle(state, task);
  const self = selfActions(state, task, me);
  const targets = statusTargets(state, task, me);
  const items = timeline(task);

  const selfLabel = (a: SelfAction) => {
    if (a === "take" && task.assignee !== undefined) return t("taskTakeOver");
    if (a === "unassign" && task.assignee !== me?.member_id) return t("taskClearAssignee");
    return t(SELF_ACTION_TEXT[a]);
  };
  const selfOp: Record<SelfAction, string> = { take: "task.assign", unassign: "task.unassign", join: "task.join", leave: "task.leave" };

  const people = Object.values(state.members)
    .filter((m) => m.status === "active" && m.member_id !== task.assignee)
    .sort((a, b) => (a.profile?.display_name ?? "").localeCompare(b.profile?.display_name ?? ""));

  return (
    <Screen>
      <Stack.Screen options={{ title: task.title }} />
      <DisabledScope entry={entry}>
        <Title>{task.title}</Title>
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
        {task.description ? <Markdown testID="task-description" source={task.description} /> : null}
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

        {self.map((a, i) => (
          <Button
            key={a}
            testID={`self-${a}`}
            kind={i === 0 && a !== "unassign" && a !== "leave" ? "primary" : "secondary"}
            haptic={a === "take" ? "confirm" : "light"}
            label={selfLabel(a)}
            onPress={() => submit(selfOp[a], {})}
          />
        ))}
        {manager && isOpen(task) ? (
          <>
            <Button testID="assign-other" kind="secondary" label={t("taskAssignOther")} onPress={() => setAssigning(!assigning)} />
            {assigning
              ? people.map((m, i) => (
                  <Enter key={m.member_id} delay={i * 40}>
                    <Card>
                      <Body>{m.profile?.display_name ?? "?"}</Body>
                      <Button
                        testID={`assign-${m.member_id}`}
                        kind="secondary"
                        label={t("taskAssignee")}
                        onPress={() => {
                          submit("task.assign", { member_id: m.member_id });
                          setAssigning(false);
                        }}
                      />
                    </Card>
                  </Enter>
                ))
              : null}
          </>
        ) : null}

        {targets.length > 0 ? (
          <View style={{ gap: space.s }}>
            <Label>{isOpen(task) ? t("taskMoveTo") : t("taskReopen")}</Label>
            {isOpen(task) ? <Field testID="status-note" label={t("taskStatusNote")} value={note} onChangeText={setNote} /> : null}
            {targets.map((s) => (
              <Button
                key={s}
                testID={`status-${s}`}
                kind={s === "cancelled" ? "danger" : s === "done" ? "primary" : "secondary"}
                haptic={s === "done" ? "confirm" : "light"}
                label={t(STATUS_TEXT[s])}
                onPress={async () => {
                  if (s === "cancelled" && !(await confirm(t("taskCancelConfirm"), t("yes"), t("no")))) return;
                  submit("task.status", { status: s, ...(note.trim() ? { note: note.trim() } : {}) });
                  setNote("");
                }}
              />
            ))}
          </View>
        ) : null}

        {canEdit(state, task, me) ? (
          <Button testID="edit-task" kind="secondary" label={t("editTask")} onPress={() => router.push({ pathname: "/c/[id]/task-form", params: { id: entry.id, tid: task.task_id } })} />
        ) : null}

        <Heading>{t("taskComments")}</Heading>
        {items.map((item) =>
          item.kind === "status" ? (
            <Text key={`s${item.seq}`} style={{ color: c.muted, fontFamily: fonts.text, fontSize: 14 }}>
              {item.seq === task.created_seq
                ? `${nameOf(state, item.change.by, "?")} ${t("taskCreatedBy")}`
                : `${nameOf(state, item.change.by, "?")} ${t("taskStatusChanged")} ${t(STATUS_TEXT[item.change.status]).toLowerCase()}${item.change.note ? `: ${item.change.note}` : ""}`}
            </Text>
          ) : (
            <Card key={item.comment.comment_id} testID={`comment-${item.comment.comment_id.slice(0, 8)}`}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.s }}>
                <Text style={{ color: c.text, fontFamily: fonts.text, fontSize: 15, fontWeight: "700" }}>{nameOf(state, item.comment.author, "?")}</Text>
                {item.comment.edited_seq !== undefined ? <Chip label={t("taskCommentEdited")} /> : null}
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
                </>
              ) : (
                <Markdown source={item.comment.body} />
              )}
              <View style={{ flexDirection: "row", gap: space.s }}>
                {item.comment.author === me?.member_id && editing !== item.comment.comment_id ? (
                  <View style={{ flex: 1 }}>
                    <Button
                      kind="secondary"
                      label={t("taskCommentEdit")}
                      onPress={() => {
                        setEditing(item.comment.comment_id);
                        setEditText(item.comment.body);
                      }}
                    />
                  </View>
                ) : null}
                {canDeleteComment(state, task, item.comment, me) ? (
                  <View style={{ flex: 1 }}>
                    <Button kind="danger" label={t("taskCommentDelete")} onPress={() => submit("task.comment_delete", { comment_id: item.comment.comment_id })} />
                  </View>
                ) : null}
              </View>
            </Card>
          ),
        )}
        {canComment(state, task, me) ? (
          <>
            <Field testID="comment-text" label={t("taskComments")} placeholder={t("taskCommentPlaceholder")} value={comment} onChangeText={setComment} multiline />
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

        {canRemove(state, task, me) ? (
          <Button
            testID="remove-task"
            kind="danger"
            label={t("taskRemove")}
            onPress={async () => {
              if (!(await confirm(t("taskRemoveConfirm"), t("yes"), t("no")))) return;
              submit("task.remove", {});
              router.back();
            }}
          />
        ) : null}
      </DisabledScope>
    </Screen>
  );
}

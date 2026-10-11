// New task, or editing one (`tid`). `eid` preselects the action.

import { canModerate, TASK_LIMITS, type Attachment, type TaskPriority } from "@vamo-virar/domain";
import { toHex } from "@vamo-virar/protocol";
import * as ExpoCrypto from "expo-crypto";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { useApp, useCommunity } from "../../../lib/context";
import { canManage as canManageEvent } from "../../../model/events";
import { canEdit, canManage, parseTagInput, PRIORITY_ORDER, PRIORITY_TEXT } from "../../../model/tasks";
import { formatDateInput, parseLocal } from "../../../model/time";
import { DisabledScope } from "../../../ui/community/Disabled";
import { Banner, Body, Button, Field, Screen } from "../../../ui/kit";
import { space } from "../../../ui/theme";
import { AttachmentList } from "../../../ui/tasks/Attachments";
import { Choices, Label } from "../../../ui/tasks/TaskBits";

const COMMUNITY = "community";

export default function TaskForm() {
  const { id, tid, eid } = useLocalSearchParams<{ id: string; tid?: string; eid?: string }>();
  const { t, store } = useApp();
  const entry = useCommunity(id);
  const state = entry?.replica.view;
  const me = entry && state ? state.members[entry.replica.memberId] : undefined;
  const existing = tid && state ? state.tasks?.[tid] : undefined;

  const [title, setTitle] = useState(existing?.title ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [scope, setScope] = useState<string>(existing ? (existing.event_id ?? COMMUNITY) : (eid ?? COMMUNITY));
  const [tags, setTags] = useState(existing?.tags.join(", ") ?? "");
  const [priority, setPriority] = useState<TaskPriority>(existing?.priority ?? "normal");
  const [due, setDue] = useState(existing?.due_at !== undefined ? formatDateInput(existing.due_at) : "");
  const [assignee, setAssignee] = useState<string | null>(existing?.assignee ?? null);
  const [attachments, setAttachments] = useState<Attachment[]>(existing?.attachments ?? []);
  const [error, setError] = useState<string | null>(null);

  if (!entry || !state || !me) return <Screen><Body>…</Body></Screen>;
  if (existing && !canEdit(state, existing, me)) return <Screen><Body muted>{t("why_not_authorized")}</Body></Screen>;

  const mod = canModerate(state, me);
  const manager = existing ? canManage(state, existing, me) : true;
  const events = Object.values(state.events)
    .filter((ev) => ev.status === "scheduled" && canManageEvent(state, ev, me))
    .sort((a, b) => a.starts_at - b.starts_at);
  const scopeOptions = [...(mod ? [{ value: COMMUNITY, label: t("taskScopeCommunity") }] : []), ...events.map((ev) => ({ value: ev.event_id, label: ev.title }))];
  // Editing: the current scope stays available even if it would not be offered for a new task.
  if (existing && !scopeOptions.some((o) => o.value === scope)) {
    scopeOptions.unshift({ value: scope, label: scope === COMMUNITY ? t("taskScopeCommunity") : (state.events[scope]?.title ?? state.event_summaries[scope]?.title ?? "?") });
  }
  if (!existing && scopeOptions.length === 0) return <Screen><Body muted>{t("taskNoPermission")}</Body></Screen>;
  if (!existing && !scopeOptions.some((o) => o.value === scope)) setScope(scopeOptions[0]!.value);

  const people = Object.values(state.members)
    .filter((m) => m.status === "active")
    .sort((a, b) => (a.profile?.display_name ?? "").localeCompare(b.profile?.display_name ?? ""));

  function save() {
    if (!title.trim()) return setError(t("taskInvalidTitle"));
    let dueAt: number | null = null;
    if (due.trim()) {
      dueAt = parseLocal(due, "23:59");
      if (dueAt === null) return setError(t("taskInvalidDue"));
    }
    const tagList = parseTagInput(tags).slice(0, TASK_LIMITS.tags);
    const eventId = scope === COMMUNITY ? undefined : scope;
    if (existing) {
      const body: Record<string, unknown> = { task_id: existing.task_id };
      if (title.trim() !== existing.title) body.title = title.trim();
      if (description.trim() !== existing.description) body.description = description.trim();
      if (tagList.join() !== existing.tags.join()) body.tags = tagList;
      if (priority !== existing.priority) body.priority = priority;
      if ((dueAt ?? undefined) !== existing.due_at) body.due_at = dueAt;
      if (attachments.map((a) => a.blob_id).join() !== existing.attachments.map((a) => a.blob_id).join()) body.attachments = attachments;
      if (manager && eventId !== existing.event_id) body.event_id = eventId ?? null;
      if (Object.keys(body).length > 1) store.submit(entry!.id, "task.update", body as never);
    } else {
      store.submit(entry!.id, "task.create", {
        task_id: toHex(ExpoCrypto.getRandomBytes(16)),
        ...(eventId ? { event_id: eventId } : {}),
        title: title.trim(),
        description: description.trim(),
        tags: tagList,
        priority,
        ...(dueAt !== null ? { due_at: dueAt } : {}),
        ...(assignee ? { assignee } : {}),
        attachments,
      } as never);
    }
    router.back();
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: t(existing ? "editTask" : "newTask") }} />
      <DisabledScope entry={entry}>
        <Field testID="task-title" label={t("taskTitle")} value={title} onChangeText={setTitle} />
        <Field testID="task-description" label={t("taskDescription")} help={t("taskDescriptionHelp")} value={description} onChangeText={setDescription} multiline />
        {scopeOptions.length > 1 && (!existing || manager) ? (
          <View style={{ gap: space.xs }}>
            <Label>{t("taskScope")}</Label>
            <Choices<string> testID="task-scope" value={scope} onChange={setScope} options={scopeOptions} />
          </View>
        ) : null}
        <Field testID="task-tags" label={t("taskTags")} help={t("taskTagsHelp")} value={tags} onChangeText={setTags} autoCapitalize="none" />
        <View style={{ gap: space.xs }}>
          <Label>{t("taskPriority")}</Label>
          <Choices<TaskPriority> testID="task-priority" value={priority} onChange={setPriority} options={[...PRIORITY_ORDER].reverse().map((p) => ({ value: p, label: t(PRIORITY_TEXT[p]) }))} />
        </View>
        <Field testID="task-due" label={t("taskDue")} value={due} onChangeText={setDue} keyboardType="numbers-and-punctuation" placeholder="DD/MM/AAAA" />
        {!existing && manager ? (
          <View style={{ gap: space.xs }}>
            <Label>{t("taskAssignee")}</Label>
            <Body muted>{t("taskAssigneeHelp")}</Body>
            <Choices<string | null>
              testID="task-assignee"
              value={assignee}
              onChange={setAssignee}
              options={[{ value: null, label: t("taskAssigneeNone") }, ...people.map((m) => ({ value: m.member_id, label: m.member_id === me.member_id ? `${m.profile?.display_name ?? "?"} (${t("taskYou")})` : (m.profile?.display_name ?? "?") }))]}
            />
          </View>
        ) : null}
        <AttachmentList entry={entry} attachments={attachments} onChange={setAttachments} />
        {error ? <Banner tone="danger" text={error} /> : null}
        <Button testID="task-save" label={t("save")} haptic="confirm" onPress={save} />
      </DisabledScope>
    </Screen>
  );
}

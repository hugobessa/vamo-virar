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
import { normalizeMarkdown } from "../../../model/richtext";
import { formatDateInput, parseLocal } from "../../../model/time";
import { DisabledScope } from "../../../ui/community/Disabled";
import { DateField } from "../../../ui/DateField";
import { RichTextEditor } from "../../../ui/RichTextEditor";
import { Banner, Body, Button, Field, Screen } from "../../../ui/kit";
import { space } from "../../../ui/theme";
import { AttachmentList } from "../../../ui/tasks/Attachments";
import { Choices, Label, PersonPicker } from "../../../ui/tasks/TaskBits";

const DAY = 86_400_000;

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

  // Common deadlines in one tap; the date field below takes any other.
  const today = Date.now();
  const event = scope !== COMMUNITY ? (state.events[scope] ?? undefined) : undefined;
  const dueShortcuts = [
    { value: "", label: t("taskDueClear") },
    { value: formatDateInput(today + DAY), label: t("taskDueTomorrowShort") },
    { value: formatDateInput(today + 7 * DAY), label: t("taskDueWeek") },
    ...(event && event.starts_at > today ? [{ value: formatDateInput(event.starts_at), label: t("taskDueEventDay") }] : []),
  ].filter((o, i, all) => all.findIndex((x) => x.value === o.value) === i);

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
      // The editor rewrites Markdown in its own way; only a real change to the text counts.
      if (description.trim() !== existing.description && description.trim() !== normalizeMarkdown(existing.description)) body.description = description.trim();
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
        <RichTextEditor testID="task-description" label={t("taskDescription")} value={description} onChange={setDescription} placeholder={t("taskDescriptionPlaceholder")} />
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
        <View style={{ gap: space.s }}>
          <Label>{t("taskDueLabel")}</Label>
          <Choices<string> testID="due" value={due.trim()} onChange={setDue} options={dueShortcuts} />
          <DateField testID="task-due" value={due} onChange={setDue} />
        </View>
        {!existing && manager ? (
          <View style={{ gap: space.xs }}>
            <PersonPicker testID="task-assignee" label={t("taskAssignee")} people={people} value={assignee} onChange={setAssignee} me={me.member_id} none={t("taskAssigneeNone")} />
            <Body muted>{t("taskAssigneeHelp")}</Body>
          </View>
        ) : null}
        <AttachmentList entry={entry} attachments={attachments} onChange={setAttachments} />
        {error ? <Banner tone="danger" text={error} /> : null}
        <Button testID="task-save" label={t("save")} haptic="confirm" onPress={save} />
      </DisabledScope>
    </Screen>
  );
}

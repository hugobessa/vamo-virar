// A task's files: the list, opening one, and (when editing) adding or
// removing. Files are sealed on this phone before they leave it; the names
// and sizes shown come from the task, never from the server.

import { TASK_LIMITS, type Attachment } from "@vamo-virar/domain";
import { useState } from "react";
import { Text, View } from "react-native";
import { useApp } from "../../lib/context";
import { openFile, pickFile } from "../../lib/files";
import type { CommunityEntry } from "../../lib/store";
import { errorText } from "../../model/errors";
import { Banner, Body, Button, Card } from "../kit";
import { fonts, space, useTheme } from "../theme";
import { Label } from "./TaskBits";

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

export function AttachmentList({
  entry,
  attachments,
  onChange,
}: {
  entry: CommunityEntry;
  attachments: Attachment[];
  /** Present when the person may add and remove files. */
  onChange?: (next: Attachment[]) => void;
}) {
  const { t } = useApp();
  const c = useTheme();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function open(a: Attachment) {
    setBusy(a.blob_id);
    setError(null);
    try {
      const bytes = await entry.replica.downloadAttachment(a);
      if (!bytes) setError(t("taskFileGone"));
      else await openFile(a.name, a.mime, bytes);
    } catch (e) {
      setError(/verification/.test(String((e as Error)?.message)) ? t("taskFileCorrupt") : errorText(e));
    } finally {
      setBusy(null);
    }
  }

  async function add() {
    if (attachments.length >= TASK_LIMITS.attachments) return setError(t("taskAttachTooMany"));
    setError(null);
    let picked: Awaited<ReturnType<typeof pickFile>>;
    try {
      picked = await pickFile();
    } catch {
      return;
    }
    if (!picked) return;
    if (picked.bytes.length > TASK_LIMITS.attachmentBytes) return setError(t("taskAttachTooLarge"));
    setBusy("upload");
    try {
      const att = await entry.replica.uploadAttachment(picked.bytes, picked.name, picked.mime);
      onChange?.([...attachments, att]);
    } catch (e) {
      setError(errorText(e, t("taskAttachFailed")));
    } finally {
      setBusy(null);
    }
  }

  if (attachments.length === 0 && !onChange) return null;
  return (
    <View style={{ gap: space.s }}>
      <Label>{t("taskAttachments")}</Label>
      {attachments.map((a) => (
        <Card key={a.blob_id} testID={`attachment-${a.blob_id.slice(0, 8)}`}>
          <Body>{a.name}</Body>
          <Text style={{ color: c.muted, fontFamily: fonts.text, fontSize: 13 }}>{`${a.mime} · ${formatSize(a.size)}`}</Text>
          <View style={{ flexDirection: "row", gap: space.s }}>
            <View style={{ flex: 1 }}>
              <Button kind="secondary" label={t("taskOpenFile")} busy={busy === a.blob_id} allowReadOnly onPress={() => void open(a)} />
            </View>
            {onChange ? (
              <View style={{ flex: 1 }}>
                <Button kind="danger" label={t("taskRemoveFile")} onPress={() => onChange(attachments.filter((x) => x.blob_id !== a.blob_id))} />
              </View>
            ) : null}
          </View>
        </Card>
      ))}
      {onChange ? <Button testID="attach-file" kind="secondary" label={busy === "upload" ? t("taskAttaching") : t("taskAttach")} busy={busy === "upload"} onPress={() => void add()} /> : null}
      {error ? <Banner tone="danger" text={error} /> : null}
    </View>
  );
}

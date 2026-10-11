import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import Community from "../../app/c/[id]/index";
import TaskForm from "../../app/c/[id]/task-form";
import TaskScreen from "../../app/c/[id]/task/[tid]";
import { communityState, COMMUNITY_NAME } from "../scenario";
import { makeEntry, openTab, screen } from "./helpers";

const meta: Meta = { title: "Telas/Tarefas", parameters: { layout: "fullscreen" } };
export default meta;
type Story = StoryObj;

const board = (o: Parameters<typeof makeEntry>[0] = {}): Story => ({
  ...screen(Community, COMMUNITY_NAME, { entries: [makeEntry({ id: "c1", ...o })], params: { id: "c1", tab: "tasks" } }),
  play: openTab("Tarefas"),
});
const task = (tid: string, o: Parameters<typeof makeEntry>[0] = {}): Story =>
  screen(TaskScreen, "Tarefa", { entries: [makeEntry({ id: "c1", ...o })], params: { id: "c1", tid } });
const form = (params: Record<string, string>, o: Parameters<typeof makeEntry>[0] = {}): Story =>
  screen(TaskForm, "Nova tarefa", { entries: [makeEntry({ id: "c1", ...o })], params: { id: "c1", ...params } });

/** Ana (admin) sees every task, grouped by status, with filters. */
export const QuadroComoAdmin: Story = board();
/** Bia organizes e1 and e2: her tasks plus the ones she runs. */
export const QuadroComoOrganizadora: Story = board({ me: "bia" });
/** Caio is a member: the pool, the tasks he helps with, and e1's tasks (he volunteered there, not confirmed). */
export const QuadroComoMembro: Story = board({ me: "caio" });
/** No tasks yet: the admin is invited to create the first. */
export const QuadroVazio: Story = (() => {
  const state = communityState();
  delete state.tasks;
  return board({ state });
})();
export const QuadroVazioComoMembro: Story = (() => {
  const state = communityState();
  delete state.tasks;
  return board({ me: "caio", state });
})();

/** Bia is on it: status buttons, a note, the file and the conversation. */
export const TarefaEmAndamentoResponsavel: Story = task("t1", { me: "bia" });
/** Caio helps: he can move it and comment, not edit it. */
export const TarefaEmAndamentoAjudante: Story = task("t1", { me: "caio" });
/** Ana manages: reassign, cancel, edit, delete. */
export const TarefaEmAndamentoCoordenacao: Story = task("t1", { me: "ana" });
/** Waiting for a volunteer: any member can take it. */
export const TarefaNaFila: Story = task("t2", { me: "duda" });
export const TarefaTravada: Story = task("t3", { me: "bia" });
export const TarefaFeita: Story = task("t6", { me: "ana" });
export const TarefaEmComunidadeMarcada: Story = task("t1", { me: "bia", disabledBy: "ana" });

export const NovaTarefa: Story = form({});
export const NovaTarefaNaAcao: Story = form({ eid: "e1" }, { me: "bia" });
export const EditarTarefa: Story = form({ tid: "t1" }, { me: "bia" });

import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { userEvent, within } from "storybook/test";
import TasksRoute from "../../app/c/[id]/(tabs)/tasks";
import TaskForm from "../../app/c/[id]/task-form";
import TaskScreen from "../../app/c/[id]/task/[tid]";
import { communityState, COMMUNITY_NAME } from "../scenario";
import { makeEntry, openTab, screen } from "./helpers";

const meta: Meta = { title: "Telas/Tarefas", parameters: { layout: "fullscreen" } };
export default meta;
type Story = StoryObj;

/** The board opens on "Minhas" when the person has work, on "Todas" otherwise; `view` clicks another view. */
const board = (o: Parameters<typeof makeEntry>[0] = {}, view?: RegExp): Story => ({
  ...screen(TasksRoute, COMMUNITY_NAME, { entries: [makeEntry({ id: "c1", ...o })], params: { id: "c1" }, tab: "tasks" }),
  ...(view ? { play: openTab(view) } : {}),
});
const task = (tid: string, o: Parameters<typeof makeEntry>[0] = {}): Story =>
  screen(TaskScreen, "Tarefa", { entries: [makeEntry({ id: "c1", ...o })], params: { id: "c1", tid } });
const form = (params: Record<string, string>, o: Parameters<typeof makeEntry>[0] = {}): Story =>
  screen(TaskForm, "Nova tarefa", { entries: [makeEntry({ id: "c1", ...o })], params: { id: "c1", ...params } });

/** Ana (admin) is on one task: the figures, then her own work. */
export const MinhasComoAdmin: Story = board();
/** Bia organizes e1 and e2: what she is responsible for, and what she created and handed over. */
export const MinhasComoOrganizadora: Story = board({ me: "bia" });
/** Caio helps on one task. */
export const MinhasComoMembro: Story = board({ me: "caio" });
/** Duda is on nothing, so the board opens on "Todas"; "Minhas" is an empty state that points her to the pool. */
export const MinhasVazia: Story = board({ me: "duda" }, /^Minhas/);
/** The tasks waiting for someone, the member's way in. */
export const FilaComoMembro: Story = board({ me: "duda" }, /^Fila/);
/** Open work by who is responsible, the tasks without anyone last. */
export const EquipeComoAdmin: Story = board({}, /^Equipe/);
/** Everything by status, with filters. */
export const TodasComoAdmin: Story = board({}, /^Todas/);
/** Caio is a member: the pool, the tasks he helps with, and e1's tasks (he volunteered there, not confirmed). */
export const TodasComoMembro: Story = board({ me: "caio" }, /^Todas/);
/** Caio follows a few tasks and things moved since he last looked: news on top, dots on the cards. */
export const QuadroComNovidades: Story = board({ me: "caio", taskNewsSince: 0 });
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
/** Typing `@ca` in the comment box offers Caio; the comments above show who was mentioned. */
export const TarefaMencionando: Story = {
  ...task("t1", { me: "bia" }),
  play: async ({ canvasElement }) => {
    const box = await within(canvasElement).findByLabelText("Novo comentário");
    await userEvent.type(box, "Combinado, @ca");
  },
};
export const TarefaEmComunidadeMarcada: Story = task("t1", { me: "bia", disabledBy: "ana" });

export const NovaTarefa: Story = form({});
export const NovaTarefaNaAcao: Story = form({ eid: "e1" }, { me: "bia" });
export const EditarTarefa: Story = form({ tid: "t1" }, { me: "bia" });

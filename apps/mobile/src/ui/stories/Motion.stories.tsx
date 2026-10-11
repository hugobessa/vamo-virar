import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { BrandBox, Display, Eyebrow, StarBurst } from "../brand";
import { Button, Collapsible, Enter, Progress, Segmented, useToast } from "../kit";
import { Marquee, Reveal, Stripe, FlipWord, PhoneStory } from "../landing/motion";
import { ACTIONS, FLIP_WORDS } from "../landing/copy";
import { fonts, motion, space, useTheme } from "../theme";

const meta: Meta = { title: "Fundamentos/Movimento", parameters: { layout: "padded" } };
export default meta;
type Story = StoryObj;

function Para({ children }: { children: string }) {
  const c = useTheme();
  return <Text style={{ color: c.text, fontFamily: fonts.text, fontSize: 16, lineHeight: 24, maxWidth: 680 }}>{children}</Text>;
}

function Token({ name, value, note }: { name: string; value: string; note: string }) {
  const c = useTheme();
  return (
    <View style={{ flexDirection: "row", gap: space.m, alignItems: "baseline", borderBottomWidth: 1, borderBottomColor: c.border, paddingVertical: space.s }}>
      <Text style={{ width: 120, color: c.text, fontFamily: fonts.display, fontWeight: "800", fontSize: 14 }}>{name}</Text>
      <Text style={{ width: 220, color: c.primary, fontFamily: "monospace", fontSize: 13 }}>{value}</Text>
      <Text style={{ flex: 1, color: c.muted, fontFamily: fonts.text, fontSize: 14 }}>{note}</Text>
    </View>
  );
}

/** Replays a component by remounting it. */
function Replay({ children }: { children: (key: number) => React.ReactNode }) {
  const c = useTheme();
  const [k, setK] = useState(0);
  return (
    <View style={{ gap: space.m }}>
      <Pressable accessibilityRole="button" onPress={() => setK((n) => n + 1)} style={{ alignSelf: "flex-start" }}>
        <Text style={{ color: c.primary, fontFamily: fonts.text, fontWeight: "700", textDecorationLine: "underline" }}>Repetir</Text>
      </Pressable>
      <View key={k}>{children(k)}</View>
    </View>
  );
}

function Page() {
  const c = useTheme();
  const [tab, setTab] = useState("a");
  const [burst, setBurst] = useState(0);
  const [toast, showToast] = useToast();
  return (
    <View style={{ gap: space.xl, maxWidth: 1000 }}>
      <View style={{ gap: space.s }}>
        <Display size="h1" tone="brand">Movimento</Display>
        <Para>
          Quatro durações e duas curvas cobrem o produto inteiro. Tudo o que se move usa um destes tokens, e tudo respeita a preferência de menos movimento do sistema (e o botão "Movimento" na barra acima, que a simula).
        </Para>
      </View>

      <View>
        <Eyebrow>Durações</Eyebrow>
        <Token name="fast" value={`${motion.fast} ms`} note="Hover, pressionar, alternar uma etiqueta." />
        <Token name="base" value={`${motion.base} ms`} note="A maioria das transições: um cartão aparecendo, a aba deslizando." />
        <Token name="slow" value={`${motion.slow} ms`} note="Uma seção revelando, um aviso entrando." />
        <Token name="story" value={`${motion.story} ms`} note="Um compasso de uma história mais longa: a demonstração no celular, a barra enchendo." />
        <Token name="stagger" value={`${motion.stagger} ms`} note="Intervalo entre itens que entram um depois do outro." />
      </View>

      <View>
        <Eyebrow>Curvas</Eyebrow>
        <Token name="out" value={motion.css.out} note="Coisas que chegam ao lugar: desaceleram ao parar." />
        <Token name="overshoot" value={motion.css.overshoot} note="O carimbo de uma caixa da marca e o botão que afunda: passa um pouco e volta." />
      </View>

      <View style={{ gap: space.m }}>
        <Eyebrow>Carimbo (Reveal)</Eyebrow>
        <Para>As caixas da marca entram carimbadas, uma depois da outra, quando rolam para dentro da tela.</Para>
        <Replay>
          {() => (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.l }}>
              {(["red", "green", "yellow", "blue"] as const).map((tone, i) => (
                <Reveal key={tone} delay={i * motion.stagger * 2}>
                  <BrandBox tone={tone} size="lg">{`0${i + 1}`}</BrandBox>
                </Reveal>
              ))}
            </View>
          )}
        </Replay>
      </View>

      <View style={{ gap: space.m }}>
        <Eyebrow>Painel de letras (FlipWord)</Eyebrow>
        <Para>O título da landing vira literalmente: a última palavra troca como num painel de aeroporto.</Para>
        <Text style={{ color: c.brand, fontFamily: fonts.condensed, fontSize: 56, lineHeight: 56, fontWeight: "900", textTransform: "uppercase" }}>
          Vamo virar <FlipWord words={FLIP_WORDS} />
        </Text>
      </View>

      <View style={{ gap: space.m }}>
        <Eyebrow>Faixa da bandeira</Eyebrow>
        <Para>Entra varrendo da esquerda ao carregar; na landing, uma cópia fixa no topo enche com a rolagem.</Para>
        <Replay>{() => <Stripe height={8} sweep />}</Replay>
      </View>

      <View style={{ gap: space.m }}>
        <Eyebrow>Letreiro (Marquee)</Eyebrow>
        <Marquee items={ACTIONS} />
      </View>

      <View style={{ gap: space.m }}>
        <Eyebrow>Botões com profundidade</Eyebrow>
        <Para>A face afunda na borda de profundidade enquanto está pressionada; em confirmações o celular vibra de leve.</Para>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.m }}>
          <Button label="Confirmar" haptic="confirm" onPress={() => setBurst((n) => n + 1)} />
          <Button label="Destaque" kind="accent" onPress={() => showToast("Resposta enviada. Só o veredito saiu do celular.")} />
          <Button label="Secundário" kind="secondary" onPress={() => {}} />
          <Button label="Perigo" kind="danger" onPress={() => {}} />
        </View>
        <StarBurst trigger={burst} />
        {toast}
      </View>

      <View style={{ gap: space.m }}>
        <Eyebrow>Abas, barra e seções</Eyebrow>
        <Segmented value={tab} onChange={setTab} options={[{ value: "a", label: "Ações" }, { value: "b", label: "Pessoas" }, { value: "c", label: "Eu" }]} />
        <Replay>{() => <Progress value={9} max={12} label="9 de 12 confirmadas · faltam 3" />}</Replay>
        <Collapsible title="Avançado">
          <Enter>
            <Para>Conteúdo que entra deslizando quando a seção abre.</Para>
          </Enter>
        </Collapsible>
      </View>

      <View style={{ gap: space.m }}>
        <Eyebrow>A história no celular</Eyebrow>
        <Para>Oito segundos em loop: a organização pergunta quem pode ir, as respostas chegam uma a uma e a barra enche.</Para>
        <PhoneStory />
      </View>
    </View>
  );
}

export const Tokens: Story = { render: () => <Page /> };

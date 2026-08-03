# Clique e Fecha: estratégia, custos e planos (revisão consolidada)

Documento mestre e fonte oficial da nova fase do produto. Consolida: (1) custo real e arquitetura, (2) planos e posicionamento, (3) venda conduzida pelo próprio bot, (4) contratação e onboarding, e (5) decisões e roadmap. Toda decisão relevante desta fase deve ser registrada aqui. Substitui o documento de custos anterior.

Última atualização: 02/08/2026. Estado atual: estratégia comercial em definição; cadência de follow-up 1h, 6h e 20h já publicada no bot v1.29.0.

Premissas em tudo abaixo: câmbio R$ 5,50 por dólar. Preço PADRÃO da API Anthropic (Sonnet 5 US$ 3 / US$ 15 por 1M). Existe promoção (US$ 2 / US$ 10) até 31/08/2026, mas usamos o padrão de propósito: um plano vendido hoje roda por meses e não pode ficar no vermelho quando a promoção acabar.

## 1. Sumário executivo

O produto está bem posicionado e as duas decisões estruturais estão corretas e confirmadas por benchmark externo:
- Roteamento de modelo (Sonnet para o lead, Haiku para tarefas internas): já implementado (v1.27.0, no ar).
- Separar relatório nativo (sem IA, grátis) do assistente de dados (IA, add-on com teto): decidido, a implementar.

Custo médio por lead: ~R$ 0,39. Margem bruta projetada: 31% a 40%, alinhada com o normal de startup de IA em fase inicial (benchmark: SaaS AI-first maduro opera 50% a 60%; startup em hipercrescimento ~25%). Há espaço para chegar a 50% no médio prazo.

Ponto estratégico central: o benchmark mostra concorrentes de SDR com IA cobrando R$ 399 a R$ 589. O Clique e Fecha entrega LLM mais CRM nativo por R$ 197. Isso é vantagem de aquisição, mas também levanta a pergunta de se o preço de entrada não está baixo demais (seção 6).

## 2. O produto e o modelo de negócio

Plataforma de venda pelo WhatsApp que atende leads (principalmente de Meta Ads), qualifica, recomenda o plano adequado, trata dúvidas e objeções e deve avançar até a contratação. A reunião deixa de ser o destino padrão e passa a ser uma rota de exceção quando o lead pedir, quando houver complexidade ou quando o bot não conseguir avançar com segurança. O painel mantém CRM, funil, origem por anúncio, alertas operacionais e agendamentos. A análise de reunião DISC é serviço SEPARADO (repo agente-reunioes), não entra no custo por lead do bot.

Modelo: mensalidade por cliente (a empresa que usa o bot para os leads dela). O custo relevante é quanto cada cliente custa para rodar, para precificar com margem.

## 3. Custos detalhados

### 3.1 Preço da API

| Modelo | Input (1M) | Output (1M) | Em R$ (5,50) |
|---|---|---|---|
| Sonnet 5 (padrão) | US$ 3 | US$ 15 | R$ 16,50 / R$ 82,50 |
| Haiku 4.5 | US$ 1 | US$ 5 | R$ 5,50 / R$ 27,50 |
| Cache lido (Sonnet) | US$ 0,30 | | R$ 1,65 |

Haiku custa exatamente 1/3 do Sonnet. Token de SAÍDA custa 5x o de entrada: a parte cara é quanto o bot FALA.

### 3.2 Custo por lead, componente a componente

Lead que vai fundo (engaja e agenda, ~18 mensagens), já com o roteamento Haiku aplicado:

| Componente | Modelo | Vê o lead? | Custo |
|---|---|---|---|
| Conversa do bot (~18 chamadas) | Sonnet 5 | Sim | ~R$ 0,70 |
| Follow-up (até 3x) | Sonnet 5 | Sim | ~R$ 0,09 |
| Score / qualificação | Haiku 4.5 | Não | ~R$ 0,03 |
| Tipo de negócio / dor | Haiku 4.5 | Não | ~R$ 0,012 |
| Resumo da ficha (1x ao agendar) | Haiku 4.5 | Não | ~R$ 0,019 |
| Classificar intenção | Haiku 4.5 | Não | ~R$ 0,002 |
| Transcrição de áudio | Groq Whisper | Não | ~R$ 0,004 |
| Total (lead que agenda) | | | ~R$ 0,83 |

~84% do custo de um lead é a conversa do bot no Sonnet. Todo o resto somado dá ~R$ 0,13. Logo, a alavanca de custo é o volume de fala do bot, não as internas (já baratas no Haiku).

### 3.3 Custo médio por lead (diluído no funil)

| Perfil | Fração | Custo |
|---|---|---|
| Curioso (some em 2 a 4 msgs) | ~50% | ~R$ 0,15 |
| Conversa de verdade, não agenda | ~35% | ~R$ 0,55 |
| Agenda reunião | ~15% | ~R$ 0,83 |

Custo médio ponderado: ~R$ 0,39/lead (pós-Haiku; era ~R$ 0,45). É ESTIMATIVA. O bot loga tokens e modelo por chamada; após dias de tráfego dá para medir o real puxando logs do Railway.

### 3.4 Custos fixos e condicionais

- Infra (Railway: app + Postgres): ~R$ 55 a R$ 110/mês total. Multi-tenant (`CLIENT_ID`), então dilui: ~R$ 6 a 11 por cliente com 10 clientes; ~R$ 55 a 110 se isolado.
- Groq (transcrição): centavos, já contado por lead.
- WhatsApp / Meta: grátis dentro da janela de 24h. Só a reativação fora das 24h (template) custa: ~R$ 0,045 (utility) a R$ 0,35 (marketing) por envio. No fluxo atual (tudo em 24h), Meta é R$ 0.

## 4. O CRM: duas faces de custo

1. Painel em si (ver leads, funil, origem por anúncio, agendamentos, metas): leitura de banco, ~R$ 0 de IA. Só pesa na infra.
2. Assistente de dados (gestor pergunta em linguagem natural e gera gráfico): Sonnet, ~R$ 0,10 por pergunta, hoje SEM teto.

Risco do assistente sem teto:

| Uso do gestor | Custo/mês |
|---|---|
| Leve (10 perguntas) | ~R$ 1 |
| Pesado (20/dia) | ~R$ 44 |
| Abusivo (100/dia) | ~R$ 220 |

Um gestor pesado zera a margem de um plano de R$ 197 sozinho. Daí a separação (seção 7). Fato técnico a favor: os números que o assistente usa JÁ existem agregados no servidor (index.js ~linha 2751; a IA hoje só narra e desenha gráfico). Relatório sem IA é renderizar esses números direto. Custo zero.

## 5. Benchmark de mercado (Brasil, 2026)

O mercado de automação de WhatsApp divide-se em três faixas:
- Básico (R$ 50 a R$ 250/mês): bots de regras rígidas, sem IA generativa (ex: ManyChat inicial, AgeuBot).
- Intermediário (R$ 500 a R$ 2.000/mês): agentes com LLM real, integração com CRM, qualificação (ex: Halk.io, Zenvia e Blip avançados).
- Avançado (acima de R$ 2.000/mês): enterprise, múltiplos agentes, integrações complexas.

Concorrentes diretos (SDR com IA para qualificação):

| Plataforma | Preço inicial | Teto / limites | Foco |
|---|---|---|---|
| SDRBOT.ai | R$ 497/mês | 5.000 leads, 1.000 conversas | BANT/MEDDIC, handoff |
| SleekFlow | R$ 589/mês | varia | qualificação, handoff |
| Toolzz (Bot SDR) | R$ 399/mês | por MACs (contatos ativos) | omnichannel, IA |
| AsisteClick | ~US$ 20 (R$ 110) | 1 agente, 4.000 chats (sem IA generativa) | ecossistema amplo |
| Clique e Fecha | R$ 197/mês | 300 leads | CRM integrado, qualificação Meta Ads |

Conclusão do benchmark: o Clique e Fecha está na faixa de entrada (R$ 197 a R$ 397), mas oferece funcionalidades (LLM real, CRM nativo) que concorrentes cobram a partir de R$ 400 a R$ 800. Forte vantagem de aquisição, mas reforça a necessidade de controle rigoroso de custo de API.

Benchmark de margem: SaaS B2B tradicional operava 75% a 80%. Com IA generativa no núcleo, o "novo normal" para AI-first maduro é 50% a 60%; startup em fase inicial ~25%. Os 31% a 40% do Clique e Fecha estão coerentes com fase inicial, com espaço para 50% no médio prazo.

## 6. Posicionamento e a questão do preço (decisão estratégica)

O benchmark expõe uma escolha que precisa ser feita conscientemente: entregar por R$ 197 o que concorrentes cobram R$ 400 a R$ 800 é ou uma cunha de aquisição, ou preço de menos.

Duas leituras:
- R$ 197 como isca de aquisição: entra barato e monetiza no upsell, setup e add-on de créditos. Faz sentido SE esses três estiverem ativos.
- R$ 197 como subprecificação: se não houver setup, excedente e add-on recuperando margem, R$ 197 a 35% é frágil, e o Essencial deveria ser R$ 297.

Recomendação: manter R$ 197 como isca somente com setup, excedente por lead e add-on de créditos ativos. Sem esses, subir o Essencial para R$ 297. Posicionar sempre como "SDR automático que agenda reuniões" (substituto de um funcionário que custa mais de R$ 3.000), não como "bot com IA".

## 7. Os planos

Escada 197 / 297 / 397. O diferencial é FEATURE, não volume: cada 100 leads a mais custam ~R$ 45, então um degrau de R$ 100 não cobre muito mais lead com margem. Os tetos sobem pouco (só para dar progressão); o valor é o que cada plano desbloqueia.

| | Essencial | Pro | Scale |
|---|---|---|---|
| Preço/mês | R$ 197 | R$ 297 | R$ 397 |
| Bot + agenda | Sim | Sim | Sim |
| Follow básico (dentro das 24h) | Sim | Sim | Sim |
| Relatórios nativos (sem IA) | Sim | Sim | Sim |
| Painel / CRM (funil, origem, agenda) | Sim | Sim | Sim |
| Follow avançado (reativação fora das 24h, template Meta) | Não | Sim | Sim |
| Análise de reunião DISC (serviço separado) | Não | Não | Sim |
| Teto de leads/mês | 300 | 400 | 500 |
| Custo estimado/cliente | ~R$ 117 a 135 | ~R$ 180 a 210 | ~R$ 250 a 275 |
| Margem aproximada | ~35 a 40% | ~30 a 40% | ~31% |

Add-on de dados (IA): vendido por CRÉDITOS, comprável em qualquer plano. Ex: R$ 97 por 200 consultas. Melhor que cota mensal fixa: transforma um custo variável perigoso em receita de expansão previsível, e o cliente enxerga o consumo. Trava dura por cliente (ex: limite diário) mesmo no pacote pago, para o custo nunca fugir.

Extras recomendados nos três planos:
- Setup único (R$ 297 a R$ 497): cobre a implantação (roteiro, tom de voz, integração Meta), melhora o caixa e aumenta o comprometimento (reduz churn nos primeiros meses).
- Excedente por lead acima do teto (~R$ 0,80/lead): protege a margem de quem dispara volume.
- Repasse de template Meta: deixar claro em contrato e site que o custo de template (fora das 24h) é repassado ou faturado à parte. O Pro NÃO deve absorver o custo da Meta.
- Plano anual com 20% de desconto (opcional): previsibilidade de caixa, dilui o CAC.

Atenção: o "follow avançado" do Pro depende de construir a reativação com template Meta (item adiado, apelidado BOT-001) e adiciona custo de template por envio. Enquanto não existir, o Pro se sustenta pelo painel completo; a margem fica até melhor por não ter custo de template ainda.

## 8. Otimizações: o que fazer, adiar e descartar

Avaliação de cada sugestão da revisão externa, filtrada pelo que o código real permite.

### 8.1 Já feito
- Roteamento de modelo (Sonnet para o lead, Haiku para internas), v1.27.0. Cortou ~14% do custo médio por lead. Confirmado como boa prática pelo benchmark.

### 8.2 Fazer agora (barato, risco baixo, retorno imediato)
- Limite de output no roteiro. Instruir o Sonnet a responder em poucas frases curtas. Output custa 5x o input, então concisão é margem direta. Só prompt. Cuidado: apertar demais deixa o bot seco e derruba conversão; calibrar.
- Observabilidade de custo por CLIENT_ID. O bot já loga tokens por chamada (index.js:4873); falta carimbar CLIENT_ID e a função. Barato e é o que troca a estimativa pelo custo real medido, insumo direto para a decisão da seção 6.

### 8.3 Fazer no roadmap (quando as decisões fecharem)
- Relatório nativo (sem IA) em todos os planos: renderizar os números já agregados direto no painel. Custo zero.
- Add-on de dados por créditos, com flag e trava dura por cliente.
- Setup, excedente por lead, repasse de template Meta, plano anual com desconto.

### 8.4 Descartar ou adiar (onde a revisão externa não conhecia o código)
- Batch API nas tarefas internas: DESCARTAR. A revisão sugeriu mandar classificação de intenção, extração de dor e resumo para a Batch API (50% mais barato). Não encaixa: Batch é assíncrono (resposta em até 24h), e essas chamadas são SÍNCRONAS dentro da conversa. A classificação de intenção decide na hora se o lead confirmou ou cancelou a reunião; a extração de dor alimenta o contexto da própria conversa. Não dá para esperar. O único candidato seria o resumo da ficha, com economia de ~R$ 0,01/lead (já é Haiku), que não paga a complexidade.
- Semantic caching para FAQs: ADIAR. Cachear respostas de perguntas comuns corta custo, mas bate de frente com o diferencial do produto: conversa personalizada e contextual (a resposta depende do nome, da dor e do anúncio de origem). Cachear resposta pronta robotiza a parte que vende, e tem custo de implementar (banco de vetores/Redis). No volume atual não compensa; reavaliar ao escalar muito.

## 9. Decisões em aberto

1. R$ 197 é cunha de aquisição (com setup + excedente + add-on ativos) ou o Essencial sobe para R$ 297? (Depende do item 8.2 medir o custo real.)
2. Add-on de dados: pacote de créditos avulso (recomendado) vs embutido no Scale. Valor sugerido: R$ 97 por 200 consultas.
3. Trava dura do assistente: limite diário por cliente (ex: 30/dia) e o que acontece ao estourar (bloqueia vs cobra excedente).
4. Câmbio e meta de margem oficiais para travar os preços (aqui: R$ 5,50 e ~35 a 40%, com alvo de 50% no médio prazo).
5. Plano anual com desconto: sim ou não.

## 10. Plano de ação priorizado

1. Limite de output no roteiro (prompt, agora).
2. CLIENT_ID mais tag de função nos logs de custo (agora). Insumo para decidir R$ 197 vs R$ 297.
3. Acompanhamento semanal de custo por lead nos 3 primeiros meses pós v1.27.0. Gatilho: se o custo real passar de R$ 0,45 (comprometendo 35% de margem), reduzir teto de leads ou subir o preço base.
4. Camada de relatório nativo (sem IA) no painel.
5. Add-on de créditos com flag e trava dura.
6. Setup, excedente, repasse de template Meta, plano anual.
7. Não fazer: Batch API e semantic caching por enquanto.

## 11. Restrições e fatos técnicos que não podem se perder

- Nunca usar travessão em copy do produto nem em respostas: usar ponto, vírgula, dois-pontos.
- Sempre avisar qual versão foi ao ar (release e commit) a cada deploy.
- Deploy: push para o repositório, Railway faz deploy automático. Validação por print de produção.
- Fuso do negócio: Campo Grande (America/Campo_Grande).
- Bot multi-tenant (`CLIENT_ID`): permite diluir infra entre clientes.
- Análise DISC é serviço SEPARADO (repo agente-reunioes), fora do custo por lead do bot.
- Modelos configuráveis por env: `CLAUDE_MODEL` (lead) e `CLAUDE_MODEL_INTERNO` (interno). Padrões: claude-sonnet-5 e claude-haiku-4-5. Dá para pinar de volta no Sonnet sem deploy.
- Assistente de dados do painel: chamada Sonnet em index.js ~linha 2751; os dados agregados já existem antes da chamada.

## 12. Nova fase: o bot como vendedor completo

### 12.1 Direção aprovada

O objetivo deixa de ser apenas qualificar e agendar. O bot deve tentar concluir a venda sempre que a necessidade couber em um plano padronizado. A reunião com Adriano será usada somente quando:

- o lead pedir atendimento humano ou demonstração;
- a necessidade não couber claramente nos planos;
- houver negociação, desconto ou condição especial;
- existir dúvida contratual, técnica ou operacional fora da base aprovada;
- o bot não conseguir superar a mesma objeção após duas tentativas úteis;
- o risco de recomendar o plano errado for maior que o benefício da contratação direta.

### 12.2 Fluxo comercial desejado

1. Receber e contextualizar o lead usando nome, anúncio e mensagem de entrada.
2. Descobrir negócio, operação atual, principal problema, volume e urgência.
3. Confirmar se existe aderência ao produto.
4. Recomendar um único plano e explicar por que ele é o mais adequado.
5. Apresentar preço, limites, setup, excedentes e itens não incluídos.
6. Tratar dúvidas e objeções sem inventar promessas.
7. Confirmar a escolha do lead.
8. Conduzir para contratação e pagamento.
9. Confirmar o resultado e iniciar onboarding.
10. Oferecer reunião somente nas exceções definidas acima.

### 12.3 Três rotas de conversão

| Situação | Rota |
|---|---|
| Necessidade simples, plano claro e lead decidido | Contratação direta pelo bot |
| Lead com aderência, mas inseguro | Demonstração ou reunião consultiva |
| Operação complexa ou necessidade personalizada | Reunião obrigatória com Adriano |

### 12.4 Limites de autoridade do bot

O bot pode somente:

- oferecer planos, preços e condições cadastrados e ativos;
- recomendar plano por critérios objetivos e auditáveis;
- explicar recursos com base na documentação oficial;
- aplicar benefício ou desconto previamente autorizado por regra;
- enviar links oficiais de contratação e pagamento;
- registrar aceite, pagamento, onboarding ou encaminhamento humano.

O bot nunca pode:

- inventar desconto, prazo, integração, funcionalidade, case ou garantia;
- negociar livremente;
- esconder setup, limite, excedente ou custo da Meta;
- confirmar pagamento sem retorno do provedor;
- prometer implantação antes de validar os pré-requisitos;
- continuar pressionando após recusa clara ou pedido de opt-out.

### 12.5 Implantação recomendada

Fase 1, venda assistida: o bot recomenda o plano, apresenta preço, trata objeções e chega até “quero contratar”. Adriano conclui os primeiros fechamentos. Objetivo: validar discurso, dúvidas, plano recomendado e causas de perda.

Fase 2, contratação direta: integrar checkout, confirmação de pagamento, aceite contratual e início do onboarding. Liberar apenas depois de revisar conversas reais suficientes da Fase 1.

Fase 3, otimização: medir conversão por plano, intervenção humana, objeção, anúncio e segmento. Ajustar roteiro e critérios sem permitir negociação aberta pela IA.

## 13. Requisitos para liberar venda direta

Antes de o bot cobrar ou contratar, precisam estar fechados:

1. Planos, preços, setup, limites, excedentes e impostos.
2. Matriz objetiva de recomendação de plano.
3. Perguntas mínimas obrigatórias antes da recomendação.
4. Base oficial de respostas sobre produto, implantação, suporte e cancelamento.
5. Política de desconto e autoridade comercial.
6. Meio de pagamento, webhook de confirmação e tratamento de falha.
7. Aceite contratual e termos aplicáveis.
8. Fluxo de onboarding e requisitos da Meta.
9. Handoff para Adriano com resumo completo e motivo do encaminhamento.
10. Métricas, alertas e auditoria de cada etapa.

## 14. Métricas da nova fase

O indicador principal deixa de ser somente “reuniões agendadas”. O painel deve acompanhar:

- vendas concluídas pelo bot;
- receita recorrente vendida pelo bot;
- conversão de lead para venda;
- conversão por plano, anúncio e segmento;
- percentual de vendas sem intervenção humana;
- percentual encaminhado para reunião e respectivo motivo;
- recuperação por follow-up;
- objeções mais frequentes;
- recomendação de plano alterada pelo humano;
- falha de pagamento, mensagem ou integração;
- tempo entre primeiro contato e contratação.

## 15. Decisões ainda necessárias para a venda pelo bot

1. Confirmar a escada final de preços e se R$ 197 permanece como entrada.
2. Definir exatamente o que diferencia Essencial, Pro e Scale.
3. Escolher setup e forma de cobrança.
4. Definir critérios de recomendação de cada plano.
5. Escolher provedor de pagamento e modelo de checkout.
6. Decidir se o contrato será aceite simples, assinatura eletrônica ou ambos.
7. Definir quando o bot pode oferecer reunião sem o lead pedir.
8. Definir política de cancelamento, suporte e prazo de implantação.

## 16. Próximo ciclo de trabalho

1. Fechar a oferta comercial antes de alterar o roteiro de venda.
2. Construir a matriz de recomendação dos planos.
3. Escrever o roteiro da Fase 1 até “quero contratar”.
4. Criar campos e etapas de contratação no CRM sem alterar a ordem atual do Kanban antes de aprovação.
5. Rodar simulações para cada plano, objeção, pedido de reunião e caso fora de escopo.
6. Testar com leads reais em modo assistido.
7. Só então integrar pagamento e ativar contratação direta.

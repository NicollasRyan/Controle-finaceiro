"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, type User } from "firebase/auth";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch, type Resolver } from "react-hook-form";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowDownLeft, ArrowLeft, ArrowRight, ArrowUpRight, Bell, Check, ChevronDown, CircleHelp, CreditCard, FileClock, LayoutDashboard, LogOut, Menu, Pencil, Plus, Search, Settings2, SlidersHorizontal, Sparkles, Tags, Wallet, X, Trash2, ReceiptText, CalendarDays, LoaderCircle, LockKeyhole } from "lucide-react";
import { auth, firebaseConfigured } from "@/lib/firebase";
import { formatDate, formatMoney, monthLabel, toCents, currentMonth, localDateString } from "@/lib/format";
import { transactionSchema, recurrenceSchema, budgetSchema, type TransactionInput, type RecurrenceInput, type BudgetInput } from "@/domain/schemas";
import type { Budget, FinanceNotification, Recurrence, Transaction } from "@/domain/models";
import { activeBudgetsForMonth, budgetCategoriesForMonth, budgetUsage, summarize } from "@/domain/finance";
import { addTransaction, getOpeningBalance, listBudgets, listNotifications, listRecurrences, listTransactions, markNotificationRead, patchTransaction, removeBudget, removeTransaction, saveBudget, saveOpeningBalance, saveRecurrence } from "@/repositories/financeRepository";
import { generateOccurrences, setTransactionStatus, syncNotifications } from "@/services/financeService";

type Section = "Visão geral" | "Receitas" | "Despesas" | "Contas recorrentes" | "Limites de gastos" | "Histórico" | "Relatórios" | "Configurações";
const sections: { name: Section; icon: typeof LayoutDashboard }[] = [
  { name: "Visão geral", icon: LayoutDashboard }, { name: "Receitas", icon: ArrowDownLeft }, { name: "Despesas", icon: ArrowUpRight },
  { name: "Contas recorrentes", icon: CreditCard }, { name: "Limites de gastos", icon: SlidersHorizontal }, { name: "Histórico", icon: FileClock },
  { name: "Relatórios", icon: ReceiptText }, { name: "Configurações", icon: Settings2 },
];
const today = () => localDateString();

export function FinanceApp() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [section, setSection] = useState<Section>("Visão geral");
  const [month, setMonth] = useState(currentMonth());
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [openingBalanceCents, setOpeningBalanceCents] = useState(0);
  const [recurrences, setRecurrences] = useState<Recurrence[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [modal, setModal] = useState<"income" | "expense" | "recurrence" | "budget" | "edit" | null>(null);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [budgetEditing, setBudgetEditing] = useState<Budget | null>(null);
  const [toast, setToast] = useState("");
  const [loading, setLoading] = useState(true);
  const [mobileNav, setMobileNav] = useState(false);
  const [filter, setFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [notifications, setNotifications] = useState<FinanceNotification[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  function notify(message: string) { setToast(message); window.setTimeout(() => setToast(""), 3200); }

  useEffect(() => onAuthStateChanged(auth, (next) => { setUser(next); setAuthReady(true); }), []);
  useEffect(() => {
    if (!user || !firebaseConfigured) return;
    let active = true;
    void (async () => {
      try {
        await generateOccurrences(user.uid, month);
        const [txs, rules, limits, openingBalance] = await Promise.all([listTransactions(user.uid), listRecurrences(user.uid), listBudgets(user.uid), getOpeningBalance(user.uid)]);
        if (active) { setTransactions(txs); setRecurrences(rules); setBudgets(limits); setOpeningBalanceCents(openingBalance); }
        await syncNotifications(user.uid, month, limits);
        if (active) setNotifications(await listNotifications(user.uid));
      } catch (error) { notify(error instanceof Error ? error.message : "Não foi possível carregar seus dados."); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [user, month]);

  const current = useMemo(() => transactions.filter((item) => item.date.startsWith(month)), [transactions, month]);
  const summary = useMemo(() => summarize(current, openingBalanceCents), [current, openingBalanceCents]);
  const monthlyBudgets = useMemo(() => activeBudgetsForMonth(budgets, month), [budgets, month]);
  const visible = current.filter((item) => (section === "Receitas" ? item.type === "income" : section === "Despesas" ? item.type === "expense" : true) && (typeFilter === "all" || item.type === typeFilter) && (categoryFilter === "all" || item.category === categoryFilter) && (statusFilter === "all" || item.status === statusFilter) && `${item.description} ${item.category ?? ""}`.toLowerCase().includes(filter.toLowerCase())).sort((a, b) => b.date.localeCompare(a.date));
  const trend = Array.from({ length: 6 }, (_, index) => {
    const monthDate = new Date(Number(month.slice(0, 4)), Number(month.slice(5)) - 5 + index, 1);
    const key = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, "0")}`;
    const items = transactions.filter((item) => item.date.startsWith(key));
    return { month: new Intl.DateTimeFormat("pt-BR", { month: "short" }).format(monthDate), receitas: items.filter((item) => item.type === "income" && item.status === "received").reduce((sum, item) => sum + item.amountCents / 100, 0), despesas: items.filter((item) => item.type !== "income" && item.status === "paid").reduce((sum, item) => sum + item.amountCents / 100, 0) };
  });

  async function addMovement(data: TransactionInput, type: "income" | "expense") {
    if (!user) return;
    try {
      const movement: Omit<Transaction, "id"> = { description: data.description, amountCents: toCents(data.amount), type, status: type === "income" ? "received" : "paid", date: data.date, ...(type === "expense" ? { category: data.category || undefined, note: data.note || undefined } : {}), createdAt: Date.now() };
      await addTransaction(user.uid, movement);
      notify(type === "income" ? "Receita registrada." : "Despesa registrada."); setModal(null);
      setTransactions(await listTransactions(user.uid));
    } catch (error) { notify(error instanceof Error ? error.message : "Não foi possível salvar."); }
  }
  async function updateMovement(data: TransactionInput) {
    if (!user || !editing) return;
    const updates: Partial<Transaction> = { description: data.description, amountCents: toCents(data.amount), date: data.date };
    if (editing.type !== "income") { updates.category = data.category || undefined; updates.note = data.note || undefined; }
    try { await patchTransaction(user.uid, editing.id, updates); setTransactions(await listTransactions(user.uid)); setModal(null); setEditing(null); notify("Movimentação atualizada."); }
    catch (error) { notify(error instanceof Error ? error.message : "Não foi possível atualizar."); }
  }
  async function addRule(data: RecurrenceInput) {
    if (!user) return;
    const id = crypto.randomUUID();
    try { await saveRecurrence(user.uid, { id, name: data.name, amountCents: toCents(data.amount), type: data.type, day: data.day, frequency: data.frequency, startDate: data.startDate, endDate: data.endDate || undefined, category: data.category || undefined, active: true }); notify("Recorrência criada."); setModal(null); setRecurrences(await listRecurrences(user.uid)); await generateOccurrences(user.uid, month); setTransactions(await listTransactions(user.uid)); }
    catch (error) { notify(error instanceof Error ? error.message : "Não foi possível salvar."); }
  }
  async function addLimit(data: BudgetInput) {
    if (!user) return;
    const start = data.startPeriod ? parseBudgetPeriod(data.startPeriod) : null;
    const end = data.endPeriod ? parseBudgetPeriod(data.endPeriod) : null;
    const existing = budgetEditing ?? budgets.find((item) => item.category.toLocaleLowerCase("pt-BR") === data.category.toLocaleLowerCase("pt-BR") && (
      item.periodType === data.periodType && (
        data.periodType === "recurring" || (item.startMonth === start?.month && item.startYear === start?.year && (data.periodType !== "custom_range" || (item.endMonth === end?.month && item.endYear === end?.year)))
      ) || (!item.periodType && data.periodType === "specific_month" && item.month === data.startPeriod)
    ));
    const safeCategory = encodeURIComponent(data.category.toLocaleLowerCase("pt-BR"));
    const id = existing?.id ?? (data.periodType === "recurring" ? `recurring_${safeCategory}` : data.periodType === "specific_month" ? `specific_${data.startPeriod}_${safeCategory}` : `range_${data.startPeriod}_${data.endPeriod}_${safeCategory}`);
    const recurring = data.periodType === "recurring";
    try { await saveBudget(user.uid, { id, userId: user.uid, category: data.category, limitCents: toCents(data.limit), periodType: data.periodType, startMonth: recurring ? null : start?.month ?? null, startYear: recurring ? null : start?.year ?? null, endMonth: data.periodType === "custom_range" ? end?.month ?? null : null, endYear: data.periodType === "custom_range" ? end?.year ?? null : null, createdAt: existing?.createdAt ?? Date.now(), updatedAt: Date.now() }); notify(budgetEditing ? "Limite atualizado." : "Limite salvo."); setModal(null); setBudgetEditing(null); setBudgets(await listBudgets(user.uid)); }
    catch (error) { notify(error instanceof Error ? error.message : "Não foi possível salvar."); }
  }
  async function deleteBudget(budget: Budget) {
    if (!user || !window.confirm(`Excluir o limite de “${budget.category}”? As despesas existentes serão preservadas.`)) return;
    try { await removeBudget(user.uid, budget.id); setBudgets(await listBudgets(user.uid)); notify("Limite excluído. As despesas foram mantidas."); }
    catch (error) { notify(error instanceof Error ? error.message : "Não foi possível excluir o limite."); }
  }
  function createBudget() { setBudgetEditing(null); setModal("budget"); }
  function editBudget(budget: Budget) { setBudgetEditing(budget); setModal("budget"); }
  async function settle(item: Transaction) {
    if (!user) return;
    try { await setTransactionStatus(user.uid, item, item.type === "income" ? "received" : "paid"); setTransactions(await listTransactions(user.uid)); notify(item.type === "income" ? "Receita confirmada." : "Conta marcada como paga."); }
    catch (error) { notify(error instanceof Error ? error.message : "Não foi possível atualizar."); }
  }
  async function deleteItem(item: Transaction) {
    if (!user || !window.confirm(`Excluir “${item.description}”?`)) return;
    try { await removeTransaction(user.uid, item.id); setTransactions(await listTransactions(user.uid)); notify("Movimentação excluída."); }
    catch (error) { notify(error instanceof Error ? error.message : "Não foi possível excluir."); }
  }
  async function readNotification(item: FinanceNotification) {
    if (!user || item.read) return;
    try { await markNotificationRead(user.uid, item.id); setNotifications((items) => items.map((entry) => entry.id === item.id ? { ...entry, read: true } : entry)); }
    catch (error) { notify(error instanceof Error ? error.message : "Não foi possível atualizar a notificação."); }
  }
  async function changeOpeningBalance(value: number) {
    if (!user) return;
    const amount = Math.round(value * 100);
    try { await saveOpeningBalance(user.uid, amount); setOpeningBalanceCents(amount); notify("Saldo inicial atualizado."); }
    catch (error) { notify(error instanceof Error ? error.message : "Não foi possível salvar o saldo."); }
  }

  if (!authReady) return <div className="splash"><div className="brand-mark"><Wallet size={23} /></div><span>fluxo</span></div>;
  if (!user || !firebaseConfigured) return <AuthScreen configured={firebaseConfigured} onToast={notify} toast={toast} />;

  return <div className="app-shell">
    <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
      <div className="brand"><div className="brand-mark"><Wallet size={22} /></div><span>fluxo</span><button className="icon-button close-nav" onClick={() => setMobileNav(false)} aria-label="Fechar menu"><X size={18} /></button></div>
      <div className="workspace-label">ESPAÇO PESSOAL</div>
      <nav>{sections.map(({ name, icon: Icon }) => <button key={name} className={`nav-item ${section === name ? "active" : ""}`} onClick={() => { setSection(name); setMobileNav(false); }}><Icon size={18} strokeWidth={1.8} /><span>{name}</span>{name === "Contas recorrentes" && current.some((x) => x.type === "bill" && x.status === "pending") && <i className="nav-dot" />}</button>)}</nav>
      <div className="sidebar-bottom"><div className="help-card"><div className="help-icon"><Sparkles size={15} /></div><strong>Organize seu dinheiro</strong><span>Um passo de cada vez. Você está no controle.</span><button onClick={() => setSection("Relatórios")}>Ver meu resumo <ArrowRight size={14} /></button></div><div className="profile-row"><div className="avatar">{user.email?.[0]?.toUpperCase() ?? "U"}</div><div className="profile-copy"><strong>{user.displayName || user.email?.split("@")[0]}</strong><span>Conta pessoal</span></div><button className="icon-button" title="Sair" onClick={() => void signOut(auth)}><LogOut size={17} /></button></div></div>
    </aside>
    {mobileNav && <button className="nav-scrim" aria-label="Fechar navegação" onClick={() => setMobileNav(false)} />}
    <main className="main-area">
      <header className="topbar"><button className="icon-button mobile-menu" aria-label="Abrir menu" onClick={() => setMobileNav(true)}><Menu size={20} /></button><div className="breadcrumbs">Meu espaço <span>/</span> <strong>{section}</strong></div><div className="topbar-actions"><div className="month-switch"><button className="icon-button" aria-label="Mês anterior" onClick={() => setMonth(shiftMonth(month, -1))}><ArrowLeft size={16} /></button><CalendarDays size={16} /><span>{monthLabel(month)}</span><button className="icon-button" aria-label="Próximo mês" onClick={() => setMonth(shiftMonth(month, 1))}><ArrowRight size={16} /></button></div><div className="notification-wrap"><button className="icon-button notification-button" title="Notificações" aria-label="Notificações" onClick={() => setShowNotifications((open) => !open)}><Bell size={18} />{notifications.some((item) => !item.read) && <i />}</button>{showNotifications && <div className="notification-popover"><div className="notification-heading"><strong>Notificações</strong><span>{notifications.filter((item) => !item.read).length} novas</span></div>{notifications.length ? notifications.slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, 8).map((item) => <button className={`notification-item ${item.read ? "is-read" : ""}`} key={item.id} onClick={() => void readNotification(item)}><span className={`notification-icon ${item.kind}`}>{item.kind === "due" ? <CalendarDays size={15} /> : <SlidersHorizontal size={15} />}</span><span><strong>{item.title}</strong><small>{item.body}</small></span>{!item.read && <i />}</button>) : <div className="notification-empty">Nenhum lembrete por enquanto.</div>}</div>}</div><div className="avatar avatar-small">{user.email?.[0]?.toUpperCase() ?? "U"}</div></div></header>
      <div className="content">
        <div className="page-heading"><div><div className="eyebrow">{greeting()}, {user.displayName?.split(" ")[0] || "bem-vindo(a)"}</div><h1>{section === "Visão geral" ? "Seu dinheiro, com clareza." : section}</h1><p>{section === "Visão geral" ? "Acompanhe sua vida financeira em um só lugar." : `Acompanhe ${section.toLowerCase()} do período selecionado.`}</p></div><button className="primary-button" onClick={() => section === "Limites de gastos" ? createBudget() : setModal(section === "Receitas" ? "income" : section === "Contas recorrentes" ? "recurrence" : "expense")}><Plus size={17} />{section === "Receitas" ? "Nova receita" : section === "Contas recorrentes" ? "Nova recorrência" : section === "Limites de gastos" ? "Novo limite" : "Nova despesa"}</button></div>
        {loading && <div className="loading-line"><LoaderCircle size={15} /> Sincronizando seus dados…</div>}
        {section === "Visão geral" && <>
          <div className="overview-grid">
            <div className="balance-card"><div className="balance-top"><span>Saldo disponível</span><span className="balance-chip"><span /> Atualizado agora</span></div><div className="balance-amount">{formatMoney(summary.availableCents)}</div><div className="balance-foot"><span>Saldo previsto no fim do mês</span><strong>{formatMoney(summary.projectedCents)}</strong></div><div className="balance-art art-one"/><div className="balance-art art-two"/></div>
            <MetricCard title="Receitas recebidas" value={summary.incomeReceivedCents} tone="green" icon={ArrowDownLeft} helper={`${current.filter((x) => x.type === "income" && x.status === "received").length} recebimentos no mês`} />
            <MetricCard title="Despesas pagas" value={summary.expensesPaidCents} tone="rose" icon={ArrowUpRight} helper={`${current.filter((x) => x.type !== "income" && x.status === "paid").length} pagamentos no mês`} />
            <MetricCard title="Contas pendentes" value={summary.billsPendingCents} tone="amber" icon={CreditCard} helper={`${current.filter((x) => x.type === "bill" && x.status === "pending").length} aguardando pagamento`} />
          </div>
          <div className="dashboard-grid"><section className="panel chart-panel"><div className="panel-heading"><div><h2>Fluxo financeiro</h2><p>Receitas e despesas ao longo do tempo</p></div><button className="select-pill" onClick={() => setSection("Relatórios")}>Últimos 6 meses <ChevronDown size={14} /></button></div><div className="chart-legend"><span><i className="legend-green" /> Receitas</span><span><i className="legend-rose" /> Despesas</span></div><div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><AreaChart data={trend} margin={{ top: 10, right: 8, left: -17, bottom: 0 }}><defs><linearGradient id="incomeFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#20a875" stopOpacity={0.14} /><stop offset="100%" stopColor="#20a875" stopOpacity={0} /></linearGradient><linearGradient id="expenseFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#e78c83" stopOpacity={0.12} /><stop offset="100%" stopColor="#e78c83" stopOpacity={0} /></linearGradient></defs><CartesianGrid vertical={false} stroke="#efeee9" strokeDasharray="4 5" /><XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fill: "#9b9a95", fontSize: 11 }} /><YAxis tickLine={false} axisLine={false} tick={{ fill: "#9b9a95", fontSize: 10 }} tickFormatter={(v: number) => v === 0 ? "0" : `${v / 1000}k`} /><Tooltip formatter={(v) => formatMoney(Number(v) * 100)} contentStyle={{ borderRadius: 12, border: "1px solid #ecebe6", fontSize: 12 }} /><Area type="monotone" dataKey="receitas" stroke="#21a878" strokeWidth={2.5} fill="url(#incomeFill)" /><Area type="monotone" dataKey="despesas" stroke="#df8980" strokeWidth={2.5} fill="url(#expenseFill)" /></AreaChart></ResponsiveContainer></div></section>
          <section className="panel upcoming-panel"><div className="panel-heading"><div><h2>Próximos compromissos</h2><p>Contas que pedem sua atenção</p></div><button className="text-link" onClick={() => setSection("Contas recorrentes")}>Ver todas <ArrowRight size={14} /></button></div><div className="upcoming-list">{current.filter((x) => x.type === "bill" && ["pending", "overdue"].includes(x.status)).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 4).map((item) => <div className="upcoming-row" key={item.id}><div className="bill-symbol"><CreditCard size={17} /></div><div className="upcoming-copy"><strong>{item.description}</strong><span>Vence em {formatDate(item.date)}</span></div><div className="upcoming-value"><strong>{formatMoney(item.amountCents)}</strong><span className={item.status === "overdue" ? "status-overdue" : "status-pending"}>{item.status === "overdue" ? "Atrasada" : "Pendente"}</span></div></div>)}{!current.some((x) => x.type === "bill" && ["pending", "overdue"].includes(x.status)) && <EmptyState icon={Check} title="Tudo em dia por aqui" subtitle="Suas contas pendentes aparecerão neste espaço." />}</div><button className="outline-button full-button" onClick={() => setModal("recurrence")}><Plus size={15} /> Adicionar conta recorrente</button></section></div>
          <section className="panel transactions-panel"><div className="panel-heading"><div><h2>Movimentações recentes</h2><p>O que aconteceu com seu dinheiro</p></div><button className="text-link" onClick={() => setSection("Histórico")}>Ver histórico <ArrowRight size={14} /></button></div><TransactionList items={current.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5)} onSettle={settle} onDelete={deleteItem} /></section>
          <section className="panel transactions-panel"><div className="panel-heading"><div><h2>Limites deste mês</h2><p>Consumo por categoria em {monthLabel(month)}</p></div><button className="text-link" onClick={() => setSection("Limites de gastos")}>Ver limites <ArrowRight size={14} /></button></div><BudgetOverview budgets={monthlyBudgets} transactions={transactions} month={month} onCreate={createBudget} onEdit={editBudget} onDelete={(item) => void deleteBudget(item)} compact /></section>
        </>}
        {section === "Receitas" && <section className="panel transactions-panel"><PanelTitle title="Receitas do período" subtitle="Entradas recebidas e valores previstos" /><TransactionList items={visible.filter((x) => x.type === "income")} onSettle={settle} onDelete={deleteItem} onEdit={(item) => { setEditing(item); setModal("edit"); }} /></section>}
        {section === "Despesas" && <section className="panel transactions-panel"><PanelTitle title="Despesas do período" subtitle="Gastos registrados pela data da compra" /><TransactionList items={visible.filter((x) => x.type === "expense")} onSettle={settle} onDelete={deleteItem} onEdit={(item) => { setEditing(item); setModal("edit"); }} /></section>}
        {section === "Contas recorrentes" && <div className="stack"><section className="panel"><PanelTitle title="Modelos de recorrência" subtitle="As ocorrências são criadas uma única vez por período." /><div className="recurrence-list">{recurrences.map((rule) => <div className="recurrence-row" key={rule.id}><div className="bill-symbol"><CreditCard size={17} /></div><div className="upcoming-copy"><strong>{rule.name}</strong><span>{frequencyLabel(rule.frequency)} · dia {rule.day} · {rule.type === "income" ? "Receita prevista" : "Conta a pagar"}</span></div><strong>{formatMoney(rule.amountCents)}</strong><span className={`recurrence-status ${rule.active ? "is-active" : ""}`}>{rule.active ? "Ativa" : "Pausada"}</span><button className="icon-button" title={rule.active ? "Pausar recorrência" : "Retomar recorrência"} onClick={async () => { const next = { ...rule, active: !rule.active }; await saveRecurrence(user.uid, next); setRecurrences(await listRecurrences(user.uid)); }}><Settings2 size={16} /></button></div>)}{!recurrences.length && <EmptyState icon={CalendarDays} title="Sem recorrências cadastradas" subtitle="Cadastre uma conta ou receita para acompanhar os próximos períodos." action="Adicionar recorrência" onAction={() => setModal("recurrence")} />}</div></section><section className="panel"><PanelTitle title="Ocorrências do mês" subtitle="Cada lançamento pode ser confirmado individualmente." /><TransactionList items={current.filter((x) => x.recurrenceId)} onSettle={settle} onDelete={deleteItem} /></section></div>}
        {section === "Limites de gastos" && <section className="panel"><PanelTitle title="Limites por categoria" subtitle={`Limites ativos em ${monthLabel(month)}; cada mês calcula apenas os próprios gastos.`} /><BudgetOverview budgets={monthlyBudgets} transactions={transactions} month={month} onCreate={createBudget} onEdit={editBudget} onDelete={(item) => void deleteBudget(item)} /></section>}
        {(section === "Histórico" || section === "Relatórios") && <div className="stack"><section className="metrics-row"><MetricCard title="Total recebido" value={summary.incomeReceivedCents} tone="green" icon={ArrowDownLeft} /><MetricCard title="Despesas pagas" value={summary.expensesPaidCents} tone="rose" icon={ArrowUpRight} /><MetricCard title="Contas pendentes" value={summary.billsPendingCents} tone="amber" icon={CreditCard} /><MetricCard title="Receitas previstas" value={summary.incomeExpectedCents} tone="blue" icon={CalendarDays} /></section>{section === "Relatórios" && <section className="panel chart-panel report-chart"><PanelTitle title="Distribuição mensal" subtitle="Entradas e saídas dos últimos seis meses." /><div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><AreaChart data={trend}><CartesianGrid vertical={false} stroke="#efeee9" strokeDasharray="4 5" /><XAxis dataKey="month" tickLine={false} axisLine={false} /><Tooltip formatter={(v) => formatMoney(Number(v) * 100)} /><Area type="monotone" dataKey="receitas" stroke="#21a878" fill="#e4f4ec" /><Area type="monotone" dataKey="despesas" stroke="#df8980" fill="#fbefed" /></AreaChart></ResponsiveContainer></div></section>}<section className="panel transactions-panel"><div className="panel-heading"><div><h2>{section === "Histórico" ? "Todas as movimentações" : "Resumo de movimentações"}</h2><p>Registros de {monthLabel(month)}</p></div><div className="history-filters"><label className="filter-select"><span>Tipo</span><select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="all">Todos</option><option value="income">Receita</option><option value="expense">Despesa</option><option value="bill">Conta recorrente</option></select></label><label className="filter-select"><span>Categoria</span><select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="all">Todas</option>{Array.from(new Set(transactions.map((item) => item.category).filter((value): value is string => Boolean(value)))).sort().map((category) => <option key={category}>{category}</option>)}</select></label><label className="filter-select"><span>Status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">Todos</option><option value="received">Recebida</option><option value="paid">Paga</option><option value="pending">Pendente</option><option value="overdue">Atrasada</option><option value="cancelled">Cancelada</option></select></label><div className="search-box"><Search size={15} /><input placeholder="Buscar" value={filter} onChange={(event) => setFilter(event.target.value)} /></div></div></div><TransactionList items={visible} onSettle={settle} onDelete={deleteItem} onEdit={(item) => { setEditing(item); setModal("edit"); }} /></section></div>}
        {section === "Configurações" && <section className="panel settings-panel"><PanelTitle title="Sua conta" subtitle="Preferências e segurança." /><div className="settings-row"><div className="settings-icon"><LockKeyhole size={17} /></div><div><strong>Conta autenticada</strong><span>{user.email}</span></div><button className="outline-button" onClick={() => void signOut(auth)}>Sair da conta <LogOut size={14} /></button></div><div className="settings-row"><div className="settings-icon"><Wallet size={17} /></div><div><strong>Saldo inicial</strong><span>Valor disponível antes dos lançamentos deste período.</span></div><OpeningBalanceEditor key={openingBalanceCents} cents={openingBalanceCents} onSave={changeOpeningBalance} /></div><div className="settings-row"><div className="settings-icon"><Wallet size={17} /></div><div><strong>Moeda padrão</strong><span>Real brasileiro · BRL</span></div><span className="settings-value">R$</span></div><div className="settings-row"><div className="settings-icon"><CircleHelp size={17} /></div><div><strong>Dados protegidos</strong><span>Seu acesso é privado e vinculado à sua conta.</span></div><span className="privacy-pill">Firestore</span></div></section>}
      </div>
      <footer className="page-footer"><span>Feito para trazer tranquilidade às suas escolhas.</span><span>Fluxo Financeiro <i /> Seus dados são privados</span></footer>
    </main>
    {modal && <Modal title={modal === "income" ? "Nova receita" : modal === "expense" ? "Nova despesa" : modal === "recurrence" ? "Nova recorrência" : modal === "edit" ? "Editar movimentação" : budgetEditing ? "Editar limite" : "Novo limite"} onClose={() => { setModal(null); setEditing(null); setBudgetEditing(null); }}><FormModal type={modal} month={month} budgets={budgets} editing={editing} budgetEditing={budgetEditing} onClose={() => { setModal(null); setEditing(null); setBudgetEditing(null); }} onCategoryInvalidated={notify} onTransaction={(data) => modal === "edit" ? void updateMovement(data) : void addMovement(data, modal === "income" ? "income" : "expense")} onRecurrence={(data) => void addRule(data)} onBudget={(data) => void addLimit(data)} /></Modal>}
    {toast && <div className="toast"><Check size={16} />{toast}</div>}
  </div>;
}

function greeting() { const hour = new Date().getHours(); return hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite"; }
function parseBudgetPeriod(value: string) { const [year, month] = value.split("-").map(Number); return { month, year }; }
function budgetPeriodLabel(budget: Budget) {
  if (budget.periodType === "recurring") return "Todos os meses";
  const start = budget.startYear && budget.startMonth ? `${budget.startYear}-${String(budget.startMonth).padStart(2, "0")}` : budget.month;
  if (!start) return "Período não definido";
  if (budget.periodType === "custom_range" && budget.endYear && budget.endMonth) return `${monthLabel(start)} a ${monthLabel(`${budget.endYear}-${String(budget.endMonth).padStart(2, "0")}`)}`;
  return monthLabel(start);
}
function shiftMonth(month: string, amount: number) { const date = new Date(Number(month.slice(0, 4)), Number(month.slice(5)) - 1 + amount, 1); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`; }
function frequencyLabel(frequency: string) { return frequency === "weekly" ? "Semanal" : frequency === "yearly" ? "Anual" : "Mensal"; }
function MetricCard({ title, value, tone, icon: Icon, helper }: { title: string; value: number; tone: string; icon: typeof Wallet; helper?: string }) { return <div className="metric-card"><div className="metric-top"><span>{title}</span><span className={`metric-icon ${tone}`}><Icon size={17} /></span></div><strong className="metric-value">{formatMoney(value)}</strong>{helper && <span className="metric-helper">{helper}</span>}</div>; }
function PanelTitle({ title, subtitle }: { title: string; subtitle: string }) { return <div className="panel-heading"><div><h2>{title}</h2><p>{subtitle}</p></div></div>; }
function BudgetOverview({ budgets, transactions, month, onCreate, onEdit, onDelete, compact = false }: { budgets: Budget[]; transactions: Transaction[]; month: string; onCreate: () => void; onEdit: (budget: Budget) => void; onDelete: (budget: Budget) => void; compact?: boolean }) {
  if (!budgets.length) return <EmptyState icon={SlidersHorizontal} title="Defina um limite para começar" subtitle="Escolha uma categoria e acompanhe seus gastos do mês." action="Criar limite" onAction={onCreate} />;
  return <div className={`budget-grid ${compact ? "budget-grid-compact" : ""}`}>{budgets.map((budget) => {
    const usage = budgetUsage(budget, transactions, month);
    return <div className="budget-card" key={budget.id}><div className="budget-card-top"><div className="category-badge"><Tags size={16} /></div><div className="budget-actions"><span className={usage.exceededCents ? "over-budget" : "budget-percent"}>{usage.percentage}%</span><button className="icon-button" aria-label={`Editar limite de ${budget.category}`} title="Editar limite" onClick={() => onEdit(budget)}><Pencil size={14} /></button><button className="icon-button budget-delete" aria-label={`Excluir limite de ${budget.category}`} title="Excluir limite" onClick={() => onDelete(budget)}><Trash2 size={14} /></button></div></div><h3>{budget.category}</h3><span className="budget-period-label">{budgetPeriodLabel(budget)}</span><div className="budget-values"><strong>{formatMoney(usage.spentCents)}</strong><span>de {formatMoney(budget.limitCents)}</span></div><div className="progress-track"><i style={{ width: `${usage.percentage}%` }} className={usage.exceededCents ? "progress-over" : ""} /></div><div className={`budget-foot ${usage.exceededCents ? "over-budget" : ""}`}>{usage.exceededCents ? `Excedeu ${formatMoney(usage.exceededCents)}` : `Disponível ${formatMoney(usage.remainingCents)}`}</div></div>;
  })}</div>;
}
function EmptyState({ icon: Icon, title, subtitle, action, onAction }: { icon: typeof Wallet; title: string; subtitle: string; action?: string; onAction?: () => void }) { return <div className="empty-state"><div className="empty-icon"><Icon size={20} /></div><strong>{title}</strong><span>{subtitle}</span>{action && <button className="text-link" onClick={onAction}>{action} <ArrowRight size={14} /></button>}</div>; }
function TransactionList({ items, onSettle, onDelete, onEdit }: { items: Transaction[]; onSettle: (item: Transaction) => void; onDelete: (item: Transaction) => void; onEdit?: (item: Transaction) => void }) {
  if (!items.length) return <EmptyState icon={ReceiptText} title="Nenhuma movimentação neste período" subtitle="Seus registros aparecerão aqui assim que você adicionar uma receita ou despesa." />;
  return <div className="table-wrap"><table><thead><tr><th>Descrição</th><th>Categoria</th><th>Data</th><th>Status</th><th className="align-right">Valor</th><th /></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><div className="transaction-title"><span className={`transaction-icon ${item.type}`}><IconFor type={item.type} /></span><strong>{item.description}</strong></div></td><td>{item.category || <span className="muted">Sem categoria</span>}</td><td>{formatDate(item.date)}</td><td><span className={`status-badge ${item.status}`}>{statusLabel(item.status)}</span></td><td className={`align-right amount ${item.type === "income" ? "amount-in" : ""}`}>{item.type === "income" ? "+ " : "− "}{formatMoney(item.amountCents)}</td><td><div className="row-actions">{(item.status === "pending" || item.status === "overdue") && <button className="mini-action" onClick={() => onSettle(item)}>{item.type === "income" ? "Confirmar" : "Pagar"}</button>}{onEdit && <button className="icon-button delete-action" title="Editar" onClick={() => onEdit(item)}><Settings2 size={15} /></button>}<button className="icon-button delete-action" title="Excluir" onClick={() => onDelete(item)}><Trash2 size={15} /></button></div></td></tr>)}</tbody></table></div>;
}
function IconFor({ type }: { type: string }) { return type === "income" ? <ArrowDownLeft size={16} /> : type === "bill" ? <CreditCard size={15} /> : <ArrowUpRight size={16} />; }
function statusLabel(status: string) { return status === "received" ? "Recebida" : status === "paid" ? "Paga" : status === "overdue" ? "Atrasada" : status === "cancelled" ? "Cancelada" : "Pendente"; }
function OpeningBalanceEditor({ cents, onSave }: { cents: number; onSave: (value: number) => void }) { const [value, setValue] = useState((cents / 100).toFixed(2)); return <form className="opening-balance-form" onSubmit={(event) => { event.preventDefault(); const parsed = Number(value); if (Number.isFinite(parsed) && parsed >= 0) onSave(parsed); }}><span>R$</span><input type="number" min="0" step="0.01" aria-label="Saldo inicial em reais" value={value} onChange={(event) => setValue(event.target.value)} /><button className="outline-button">Salvar</button></form>; }

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) { return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="modal"><div className="modal-heading"><div><span className="eyebrow">SEU CONTROLE FINANCEIRO</span><h2>{title}</h2></div><button className="icon-button" onClick={onClose} aria-label="Fechar"><X size={18} /></button></div>{children}</div></div>; }
type FormValues = { description?: string; amount?: number; date?: string; category?: string; note?: string; name?: string; type?: "income" | "bill"; day?: number; frequency?: "weekly" | "monthly" | "yearly"; startDate?: string; endDate?: string; limit?: number; periodType?: BudgetInput["periodType"]; startPeriod?: string; endPeriod?: string };
function budgetFormDefaults(budget: Budget | null, month: string): Partial<FormValues> {
  if (!budget) return { periodType: "specific_month", startPeriod: month };
  const periodType = budget.periodType ?? "specific_month";
  const startPeriod = budget.startYear && budget.startMonth ? `${budget.startYear}-${String(budget.startMonth).padStart(2, "0")}` : budget.month ?? month;
  const endPeriod = budget.endYear && budget.endMonth ? `${budget.endYear}-${String(budget.endMonth).padStart(2, "0")}` : undefined;
  return { category: budget.category, limit: budget.limitCents / 100, periodType, startPeriod: periodType === "recurring" ? undefined : startPeriod, endPeriod };
}
function FormModal({ type, month, budgets, editing, budgetEditing, onClose, onCategoryInvalidated, onTransaction, onRecurrence, onBudget }: { type: "income" | "expense" | "recurrence" | "budget" | "edit"; month: string; budgets: Budget[]; editing: Transaction | null; budgetEditing: Budget | null; onClose: () => void; onCategoryInvalidated: (message: string) => void; onTransaction: (data: TransactionInput) => void; onRecurrence: (data: RecurrenceInput) => void; onBudget: (data: BudgetInput) => void }) {
  const movement = type === "income" || type === "expense" || type === "edit";
  const isIncomeForm = type === "income" || (type === "edit" && editing?.type === "income");
  const isExpenseForm = type === "expense" || (type === "edit" && editing?.type !== "income");
  const schema = type === "recurrence" ? recurrenceSchema : type === "budget" ? budgetSchema : transactionSchema;
  const { control, register, handleSubmit, setValue, formState: { errors, isSubmitting } } = useForm<FormValues>({ resolver: zodResolver(schema) as Resolver<FormValues>, defaultValues: type === "edit" && editing ? { description: editing.description, amount: editing.amountCents / 100, date: editing.date, category: editing.category ?? "", note: editing.note ?? "" } : movement ? { date: today() } : type === "budget" ? budgetFormDefaults(budgetEditing, month) : { type: "bill", day: 10, frequency: "monthly", startDate: today() } });
  const frequency = useWatch({ control, name: "frequency" });
  const periodType = useWatch({ control, name: "periodType" });
  const purchaseDate = useWatch({ control, name: "date" });
  const selectedCategory = useWatch({ control, name: "category" });
  const periodCategories = useMemo(() => budgetCategoriesForMonth(budgets, purchaseDate?.slice(0, 7) ?? month), [budgets, month, purchaseDate]);
  const allBudgetCategories = useMemo(() => Array.from(new Set(budgets.map((budget) => budget.category))).sort((a, b) => a.localeCompare(b, "pt-BR")), [budgets]);
  const previousPurchaseDate = useRef(purchaseDate);
  useEffect(() => {
    const dateChanged = Boolean(previousPurchaseDate.current && purchaseDate && previousPurchaseDate.current !== purchaseDate);
    previousPurchaseDate.current = purchaseDate;
    if (isExpenseForm && dateChanged && selectedCategory && !periodCategories.includes(selectedCategory)) {
      setValue("category", "", { shouldDirty: true, shouldValidate: true });
      onCategoryInvalidated(`A categoria “${selectedCategory}” não está ativa em ${monthLabel(purchaseDate!.slice(0, 7))}; a seleção foi removida.`);
    }
  }, [isExpenseForm, onCategoryInvalidated, periodCategories, purchaseDate, selectedCategory, setValue]);
  const submit = handleSubmit((data) => { if (type === "budget") onBudget(data as BudgetInput); else if (type === "recurrence") onRecurrence(data as RecurrenceInput); else onTransaction(data as TransactionInput); });
  return <form className="form-grid" onSubmit={submit}>
    {movement && <><label className="field span-2">Descrição<input placeholder={isIncomeForm ? "Ex.: Salário" : "Ex.: Mercado"} {...register("description")} />{errors.description && <small>{String(errors.description.message)}</small>}</label><label className="field">Valor<input type="number" min="0.01" step="0.01" placeholder="0,00" {...register("amount")} />{errors.amount && <small>{String(errors.amount.message)}</small>}</label><label className="field">{isIncomeForm ? "Data de recebimento" : "Data da compra"}<input type="date" {...register("date")} />{errors.date && <small>{String(errors.date.message)}</small>}</label>{isExpenseForm && <><label className="field">Categoria <span className="optional">opcional</span><select {...register("category")}><option value="">Sem categoria</option>{[...new Set([...periodCategories, ...(selectedCategory && !periodCategories.includes(selectedCategory) ? [selectedCategory] : [])])].map((cat) => <option key={cat} value={cat}>{cat}</option>)}</select></label><label className="field">Observação <span className="optional">opcional</span><input placeholder="Adicione um detalhe" {...register("note")} /></label></>}</>}
    {type === "recurrence" && <><label className="field span-2">Nome da conta ou receita<input placeholder="Ex.: Internet, salário" {...register("name")} />{errors.name && <small>{String(errors.name.message)}</small>}</label><label className="field">Valor<input type="number" min="0.01" step="0.01" placeholder="0,00" {...register("amount")} />{errors.amount && <small>{String(errors.amount.message)}</small>}</label><label className="field">Tipo<select {...register("type")}><option value="bill">Conta a pagar</option><option value="income">Receita prevista</option></select></label><label className="field">Frequência<select {...register("frequency")}><option value="monthly">Mensal</option><option value="weekly">Semanal</option><option value="yearly">Anual</option></select></label><label className="field">{frequency === "weekly" ? "Dia da semana (0 dom. – 6 sáb.)" : "Dia do vencimento"}<input type="number" min={frequency === "weekly" ? 0 : 1} max={frequency === "weekly" ? 6 : 31} {...register("day")} />{errors.day && <small>{String(errors.day.message)}</small>}</label><label className="field">Data de início<input type="date" {...register("startDate")} /></label><label className="field">Data final <span className="optional">opcional</span><input type="date" {...register("endDate")} />{errors.endDate && <small>{String(errors.endDate.message)}</small>}</label><label className="field span-2">Categoria <span className="optional">opcional</span><select {...register("category")}><option value="">Sem categoria</option>{allBudgetCategories.map((cat) => <option key={cat}>{cat}</option>)}</select></label></>}
    {type === "budget" && <><label className="field span-2">Categoria<input list="category-options" placeholder="Ex.: Alimentação" {...register("category")} /><datalist id="category-options">{allBudgetCategories.map((cat) => <option key={cat} value={cat} />)}</datalist>{errors.category && <small>{String(errors.category.message)}</small>}</label><label className="field">Limite mensal<input type="number" min="0.01" step="0.01" placeholder="0,00" {...register("limit")} />{errors.limit && <small>{String(errors.limit.message)}</small>}</label><label className="field span-2">Validade<select {...register("periodType")}><option value="specific_month">Mês específico</option><option value="recurring">Todos os meses</option><option value="custom_range">Período personalizado</option></select></label>{periodType !== "recurring" && <label className="field">{periodType === "custom_range" ? "Mês inicial" : "Mês e ano"}<input type="month" {...register("startPeriod")} />{errors.startPeriod && <small>{String(errors.startPeriod.message)}</small>}</label>}{periodType === "custom_range" && <label className="field">Mês final<input type="month" {...register("endPeriod")} />{errors.endPeriod && <small>{String(errors.endPeriod.message)}</small>}</label>}{periodType === "recurring" && <p className="form-hint span-2">Este limite ficará ativo em todos os meses. O gasto é calculado separadamente para cada mês.</p>}</>}
    <div className="form-actions span-2"><button type="button" className="outline-button" onClick={onClose}>Cancelar</button><button className="primary-button" type="submit" disabled={isSubmitting}><Check size={16} />Salvar</button></div>
  </form>;
}

function AuthScreen({ configured, onToast, toast }: { configured: boolean; onToast: (message: string) => void; toast: string }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) { event.preventDefault(); if (!configured) return; setBusy(true); try { if (mode === "login") await signInWithEmailAndPassword(auth, email, password); else await createUserWithEmailAndPassword(auth, email, password); } catch (error) { onToast(error instanceof Error ? error.message : "Não foi possível entrar."); } finally { setBusy(false); } }
  return <div className="auth-page"><div className="auth-decoration"><div className="auth-orbit orbit-a"/><div className="auth-orbit orbit-b"/><div className="auth-copy"><div className="brand brand-light"><div className="brand-mark"><Wallet size={22} /></div><span>fluxo</span></div><span className="auth-kicker">UM NOVO JEITO DE OLHAR</span><h1>Mais clareza.<br />Menos preocupação.</h1><p>Organize o presente e planeje o que vem pela frente. Seu dinheiro merece um lugar simples e seguro.</p><div className="auth-note"><div className="auth-note-icon"><Sparkles size={16} /></div><span>Pequenos passos constroem<br />uma vida financeira mais leve.</span></div></div><div className="auth-decoration-footer">PRIVACIDADE EM CADA DETALHE <span>·</span> FEITO PARA VOCÊ</div></div><div className="auth-main"><div className="auth-card"><div className="auth-mobile-brand brand"><div className="brand-mark"><Wallet size={20} /></div><span>fluxo</span></div><span className="eyebrow">BEM-VINDO(A) AO FLUXO</span><h2>{configured ? mode === "login" ? "Que bom ter você de volta." : "Comece seu caminho." : "Prepare seu espaço."}</h2><p className="auth-subtitle">{configured ? mode === "login" ? "Entre para acompanhar sua vida financeira." : "Crie sua conta pessoal em poucos instantes." : "Conecte seu projeto Firebase para começar."}</p>{!configured ? <div className="firebase-setup"><div className="setup-icon"><LockKeyhole size={19} /></div><strong>Firebase ainda não configurado</strong><span>Copie <code>.env.example</code> para <code>.env.local</code> e preencha as credenciais do Firebase Web. Depois, habilite Email/Senha no Firebase Authentication.</span><div className="setup-steps"><span><i>1</i> Criar projeto no Firebase</span><span><i>2</i> Configurar as variáveis de ambiente</span><span><i>3</i> Executar <code>yarn dev</code></span></div></div> : <form className="auth-form" onSubmit={(event) => void submit(event)}><label className="field">E-mail<input type="email" autoComplete="email" required placeholder="voce@exemplo.com" value={email} onChange={(event) => setEmail(event.target.value)} /></label><label className="field">Senha<input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={6} required placeholder="Pelo menos 6 caracteres" value={password} onChange={(event) => setPassword(event.target.value)} /></label><button className="primary-button auth-submit" disabled={busy}>{busy ? <LoaderCircle size={17} className="spin" /> : <LockKeyhole size={16} />}{mode === "login" ? "Entrar na minha conta" : "Criar conta"}<ArrowRight size={16} /></button><div className="auth-switch">{mode === "login" ? "Ainda não tem uma conta?" : "Já tem uma conta?"}<button type="button" onClick={() => setMode(mode === "login" ? "signup" : "login")}>{mode === "login" ? "Criar conta" : "Fazer login"}</button></div></form>}<div className="auth-security"><LockKeyhole size={14} /> Seus dados ficam protegidos e só você tem acesso.</div></div><div className="auth-footer">© 2026 Fluxo Financeiro <span>·</span> Privacidade por padrão</div></div>{toast && <div className="toast auth-toast">{toast}</div>}</div>;
}

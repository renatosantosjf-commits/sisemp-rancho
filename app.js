// SISEMP — Controle de Empenhos do Rancho (Cmdo Bda Inf Amv)
// Armazenamento em localStorage + sincronização opcional com Google Apps Script

(function () {
  'use strict';

  const STORAGE_KEY = 'SISEMP_DATA_V6';

  // Estado da aplicação
  let state = {
    empenhos: [],
    roteiros: [],
    contatos: [],
    empresas: [],
    itensPregao: [],
    notasCredito: [],
    resumoNC: {},
    pregao: [],
    config: {
      prazoEntregaDias: 30,
      prazoReenvioDias: 30,
      prazoProcessoDias: 60,
      emailNotificacao: '',
      webhookUrl: '',
      omNome: 'COMANDO DA BRIGADA DE INFANTARIA AEROMÓVEL',
      omSub: 'Setor de Aprovisionamento / Rancho',
      omCidade: 'Caçapava - SP'
    }
  };

  // Carrega os dados iniciais
  function initState() {
    let needsSeed = true;
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed && Array.isArray(parsed.empenhos) && parsed.empenhos.length > 0) {
          // Garante filtro exclusivo de Aprovisionamento (APROV)
          parsed.empenhos = (parsed.empenhos || []).filter(e => (e.responsavel || 'APROV').toUpperCase() === 'APROV');
          if (parsed.empenhos.length === 0 && window.SISEMP_SEED && window.SISEMP_SEED.empenhos) {
            parsed.empenhos = JSON.parse(JSON.stringify(window.SISEMP_SEED.empenhos));
          }
          state = parsed;
          if (!state.empresas || !state.empresas.length) {
            state.empresas = JSON.parse(JSON.stringify(window.SISEMP_SEED?.empresas || []));
          }
          if (!state.itensPregao || !state.itensPregao.length) {
            state.itensPregao = JSON.parse(JSON.stringify(window.SISEMP_SEED?.itensPregao || []));
          }
          needsSeed = false;
        }
      } catch (e) {
        console.error('Erro ao ler localStorage', e);
      }
    }
    if (needsSeed) {
      loadSeed();
    }
  }

  function loadSeed() {
    if (window.SISEMP_SEED) {
      state.empenhos = JSON.parse(JSON.stringify(window.SISEMP_SEED.empenhos || []));
      state.roteiros = JSON.parse(JSON.stringify(window.SISEMP_SEED.roteiros || []));
      state.contatos = JSON.parse(JSON.stringify(window.SISEMP_SEED.contatos || []));
      state.empresas = JSON.parse(JSON.stringify(window.SISEMP_SEED.empresas || []));
      state.itensPregao = JSON.parse(JSON.stringify(window.SISEMP_SEED.itensPregao || []));
      state.notasCredito = JSON.parse(JSON.stringify(window.SISEMP_SEED.notasCredito || []));
      state.resumoNC = JSON.parse(JSON.stringify(window.SISEMP_SEED.resumoNC || {}));
      state.pregao = JSON.parse(JSON.stringify(window.SISEMP_SEED.pregao || []));
    }
    saveState();
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    updateKPIs();
    updateBadges();
  }

  // ===== SINCRONIZAÃ‡ÃƒO EM TEMPO REAL COM A PLANILHA SAG NO GOOGLE SHEETS =====
  const SAG_GOOGLE_SHEETS_GVIZ_URL = 'https://docs.google.com/spreadsheets/d/1OhWfjfa1FanoAlP3metBk6qetKwEGGnuz_xkRV9sGVA/gviz/tq?tqx=out:json&gid=689447546';

  window.sincronizarPlanilhaSAG = async function (notificar = false) {
    const badge = document.getElementById('sync-badge');
    const btnSync = document.getElementById('btn-sync-sag');
    if (badge) badge.innerHTML = '\u23F3 Sincronizando...';
    if (btnSync) btnSync.disabled = true;

    try {
      const resp = await fetch(SAG_GOOGLE_SHEETS_GVIZ_URL + '&_nocache=' + Date.now(), {
        method: 'GET',
        cache: 'no-store'
      });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const text = await resp.text();
      
      const jsonStr = text.replace(/^[^{]*/, '').replace(/[^}]*$/, '');
      const data = JSON.parse(jsonStr);
      const rows = data.table?.rows || [];

      let atualizados = 0;
      let novos = 0;

      rows.forEach(r => {
        const c = r.c || [];
        const ne = (c[4]?.v || '').toString().trim();
        if (!ne || !ne.match(/^\d{4}NE\d{6}/)) return;

        const ug = (c[0]?.v || '160462').toString().replace(/\.0$/, '').trim();
        const pi = (c[1]?.v || '').toString().trim();
        const nd = (c[2]?.v || '').toString().replace(/\.0$/, '').trim();
        const si = (c[3]?.v || '').toString().replace(/\.0$/, '').trim();
        const tipo = (c[5]?.v || 'ANO').toString().trim();
        
        let dataStr = '';
        if (c[6]?.f) {
          const parts = c[6].f.split('/');
          if (parts.length === 3) dataStr = `${parts[2]}-${parts[1]}-${parts[0]}`;
        }

        const fav = (c[7]?.f || c[7]?.v || '').toString().replace(/\D/g, '');
        const nomeFav = (c[8]?.v || '').toString().trim();
        const desc = (c[9]?.v || '').toString().trim();
        const local = (c[10]?.v || '').toString().trim();
        const aLiq = typeof c[11]?.v === 'number' ? c[11].v : (parseFloat(c[11]?.v || '0') || 0);
        const pago = typeof c[12]?.v === 'number' ? c[12].v : (parseFloat(c[12]?.v || '0') || 0);
        const diasEmissao = parseInt(c[13]?.v || '0', 10) || 0;
        const status = (c[14]?.v || 'A RECEBER EMPENHO').toString().trim();
        const respSecao = (c[15]?.v || '').toString().trim().toUpperCase();
        // IMPORTANTE: Carrega EXCLUSIVAMENTE empenhos do Aprovisionamento (APROV / Rancho)
        if (respSecao !== 'APROV') return;
        const justif = (c[19]?.v || '').toString().trim();

        let emp = state.empenhos.find(x => x.ne === ne);
        if (emp) {
          emp.aLiquidar = aLiq;
          emp.pago = pago;
          emp.status = status;
          emp.responsavel = respSecao;
          emp.diasEmissao = diasEmissao;
          if (desc) emp.descricao = desc;
          if (local) emp.local = local;
          if (justif) emp.justificativa = justif;
          if (emp.linhas && emp.linhas.length > 0) {
            emp.linhas[0].aLiquidar = aLiq;
            emp.linhas[0].pago = pago;
          }
          atualizados++;
        } else {
          emp = {
            ne: ne,
            ug: ug,
            pi: pi,
            nd: nd,
            si: si,
            data: dataStr,
            doc: fav,
            credor: nomeFav,
            tipo: tipo,
            ano: 2026,
            responsavel: respSecao,
            status: status,
            aLiquidar: aLiq,
            pago: pago,
            diasEmissao: diasEmissao,
            dataEnvioResp: '',
            dataEnvioEmpresa: '',
            justificativa: justif,
            local: local,
            descricao: desc,
            drivePdf: null,
            linhas: [{
              nd: nd || '339030',
              ndNome: respSecao === 'APROV' ? 'G\u00CANEROS DE ALIMENTA\u00C7\u00C3O / RANCHO' : ('DESPESA ' + respSecao),
              aLiquidar: aLiq,
              liquidadoAPagar: 0,
              pago: pago
            }]
          };
          state.empenhos.push(emp);
          novos++;
        }
      });

      saveState();

      const agora = new Date();
      const horaStr = `${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`;
      if (badge) badge.innerHTML = `\u{1F7E2} SAG Sincronizado (${horaStr})`;
      
      if (notificar) {
        showToast(`\u2705 Sincronizado com Google Sheets! ${atualizados} empenhos atualizados${novos > 0 ? `, ${novos} novos` : ''}.`, 'ok');
      }

      renderTabelaEmpenhos();
      if (typeof carregarAbaItensEmpresa === 'function') carregarAbaItensEmpresa();
      updateKPIs();
    } catch (err) {
      console.warn('Erro ao sincronizar com Google Sheets:', err);
      if (badge) badge.innerHTML = '\u26A0\uFE0F Offline / Local';
      if (notificar) {
        showToast('\u26A0\uFE0F N\u00E3o foi poss\u00EDvel sincronizar com o Google Sheets no momento. Usando dados gravados.', 'err');
      }
    } finally {
      if (btnSync) btnSync.disabled = false;
    }
  };

  // Utilitários de Formatação
  function formatMoeda(val) {
    if (val === null || val === undefined || isNaN(val)) return 'R$ 0,00';
    return Number(val).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function formatNumero(val, dec = 2) {
    if (val === null || val === undefined || isNaN(val)) return '0';
    return Number(val).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: dec });
  }

  function formatData(isoStr) {
    if (!isoStr) return '-';
    const parts = isoStr.split('-');
    if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
    return isoStr;
  }

  function formatDoc(doc) {
    if (!doc) return '-';
    const d = doc.replace(/\D/g, '');
    if (d.length === 14) {
      return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
    }
    if (d.length === 11) {
      return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
    }
    return doc;
  }

  function getDiasDecorridos(dataIso) {
    if (!dataIso) return 0;
    const ini = new Date(dataIso + 'T00:00:00');
    const hoje = new Date();
    hoje.setHours(0,0,0,0);
    const diff = hoje - ini;
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  }

  window.forcarRecarregarDados = function () {
    if (confirm('Deseja recarregar os dados originais da planilha? Isso atualizará a lista com os 77 empenhos e roteiros mais recentes.')) {
      localStorage.removeItem(STORAGE_KEY);
      loadSeed();
      updateKPIs();
      updateBadges();
      carregarAbaItensEmpresa();
      showToast('Dados originais recarregados com sucesso!', 'ok');
    }
  };

  // Toast
  function showToast(msg, type = 'ok') {
    const stack = document.getElementById('toast-stack');
    if (!stack) return;
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = msg;
    stack.appendChild(el);
    setTimeout(() => { el.remove(); }, 4000);
  }

  // Modal
  function openModal(title, bodyHtml, footerHtml = '') {
    document.getElementById('modal-title').innerHTML = title;
    document.getElementById('modal-body').innerHTML = bodyHtml;
    document.getElementById('modal-footer').innerHTML = footerHtml;
    document.getElementById('modal-backdrop').classList.add('open');
    document.body.classList.add('modal-open');
  }

  function closeModal() {
    document.getElementById('modal-backdrop').classList.remove('open');
    document.body.classList.remove('modal-open');
  }

  // Atualização dos Indicadores (KPIs)
  function updateKPIs() {
    let totALiquidar = 0;
    let totLiquidadoAPagar = 0;
    let totPago = 0;
    let totEmpenhos = state.empenhos.length;

    state.empenhos.forEach(e => {
      e.linhas.forEach(l => {
        totALiquidar += Number(l.aLiquidar || 0);
        totLiquidadoAPagar += Number(l.liquidadoAPagar || 0);
        totPago += Number(l.pago || 0);
      });
    });

    // Prazos e Envios
    let pendentesEnvio = 0;
    let reenvio30 = 0;
    let processo60 = 0;
    let noPrazo = 0;

    state.empenhos.forEach(e => {
      const aLiq = e.linhas.reduce((acc, l) => acc + Number(l.aLiquidar || 0), 0);
      if (aLiq <= 0) return; // Empenho já totalmente liquidado

      if (!e.dataEnvio) {
        pendentesEnvio++;
      } else {
        const dias = getDiasDecorridos(e.dataEnvio);
        if (dias > state.config.prazoProcessoDias) {
          processo60++;
        } else if (dias > state.config.prazoReenvioDias) {
          reenvio30++;
        } else {
          noPrazo++;
        }
      }
    });

    const kpiEl = document.getElementById('kpi-grid');
    if (kpiEl) {
      kpiEl.innerHTML = `
        <div class="kpi-card gold clickable" onclick="navigateTab('tab-empenhos')">
          <div class="kpi-label">Saldo Total a Liquidar</div>
          <div class="kpi-value">${formatMoeda(totALiquidar)}</div>
          <div class="kpi-sub">${totEmpenhos} empenhos controlados</div>
        </div>
        <div class="kpi-card info">
          <div class="kpi-label">Liquidado a Pagar</div>
          <div class="kpi-value">${formatMoeda(totLiquidadoAPagar)}</div>
          <div class="kpi-sub">Entregas aceitas no Rancho</div>
        </div>
        <div class="kpi-card success">
          <div class="kpi-label">Total Pago no Exercício</div>
          <div class="kpi-value">${formatMoeda(totPago)}</div>
          <div class="kpi-sub">Ordem bancária confirmada</div>
        </div>
        <div class="kpi-card ${processo60 > 0 ? 'danger' : (reenvio30 > 0 ? 'warning' : 'purple')} clickable" onclick="navigateTab('tab-envios')">
          <div class="kpi-label">Prazos & Notificações</div>
          <div class="kpi-value">${processo60 > 0 ? `${processo60} em Processo` : (reenvio30 > 0 ? `${reenvio30} Reenvios` : `${pendentesEnvio} a Enviar`)}</div>
          <div class="kpi-sub">${processo60} com +60d • ${reenvio30} com +30d • ${pendentesEnvio} s/ envio</div>
        </div>
      `;
    }

    renderPainelAlertas(pendentesEnvio, reenvio30, processo60, noPrazo);
    renderPainelPI();
    renderPainelFornecedores();
  }

  function updateBadges() {
    let pendentesEnvio = 0;
    let processos = 0;
    state.empenhos.forEach(e => {
      const aLiq = e.linhas.reduce((acc, l) => acc + Number(l.aLiquidar || 0), 0);
      if (aLiq <= 0) return;
      if (!e.dataEnvio) pendentesEnvio++;
      else if (getDiasDecorridos(e.dataEnvio) > state.config.prazoProcessoDias) processos++;
    });

    const pillNe = document.getElementById('pill-ne');
    if (pillNe) pillNe.innerText = state.empenhos.length;

    const pillPrazos = document.getElementById('pill-prazos');
    if (pillPrazos) pillPrazos.innerText = pendentesEnvio + processos;
  }

  function renderPainelAlertas(pend, reenv, proc, noPrazo) {
    const el = document.getElementById('painel-alertas');
    if (!el) return;
    el.innerHTML = `
      <div class="alert-list">
        ${proc > 0 ? `
          <div class="alert-item red" onclick="filtrarEnvios('processo')">
            <div class="alert-text">
              ⚖️ Processo Administrativo (> 60 dias de envio)
              <small>${proc} empenho(s) com prazo estourado sem entrega total</small>
            </div>
            <div class="alert-count neg">${proc}</div>
          </div>
        ` : ''}
        ${reenv > 0 ? `
          <div class="alert-item yellow" onclick="filtrarEnvios('reenviar')">
            <div class="alert-text">
              🔁 Notificação de Cobrança / Reenvio (> 30 dias de envio)
              <small>${reenv} empenho(s) aguardando reiteração de entrega</small>
            </div>
            <div class="alert-count" style="color:var(--warning);">${reenv}</div>
          </div>
        ` : ''}
        ${pend > 0 ? `
          <div class="alert-item blue" onclick="filtrarEnvios('pendente')">
            <div class="alert-text">
              📭 Empenhos Não Enviados à Empresa
              <small>${pend} empenho(s) cadastrados aguardando disparo automático</small>
            </div>
            <div class="alert-count" style="color:var(--info);">${pend}</div>
          </div>
        ` : ''}
        <div class="alert-item green" onclick="filtrarEnvios('prazo')">
          <div class="alert-text">
            ⏳ Empenhos Enviados no Prazo de 30 Dias
            <small>${noPrazo} empenho(s) dentro do cronograma regular de entrega</small>
          </div>
          <div class="alert-count pos">${noPrazo}</div>
        </div>
      </div>
    `;
  }

  function renderPainelPI() {
    const el = document.getElementById('painel-pi');
    if (!el) return;
    const piMap = {};
    state.empenhos.forEach(e => {
      const pi = e.pi || 'OUTROS';
      if (!piMap[pi]) piMap[pi] = { aLiquidar: 0, total: 0 };
      e.linhas.forEach(l => {
        piMap[pi].aLiquidar += Number(l.aLiquidar || 0);
        piMap[pi].total += (Number(l.aLiquidar || 0) + Number(l.liquidadoAPagar || 0) + Number(l.pago || 0));
      });
    });

    const entries = Object.entries(piMap).sort((a,b) => b[1].aLiquidar - a[1].aLiquidar);
    const maxVal = Math.max(...entries.map(x => x[1].aLiquidar), 1);

    el.innerHTML = `
      <div class="bar-list">
        ${entries.map(([pi, dados]) => `
          <div class="bar-row">
            <div class="bar-label" title="${pi}"><strong>${pi}</strong></div>
            <div class="bar-track">
              <div class="bar-fill" style="width: ${(dados.aLiquidar / maxVal * 100).toFixed(1)}%;"></div>
            </div>
            <div class="bar-val">${formatMoeda(dados.aLiquidar)}</div>
          </div>
        `).join('')}
      </div>
    `;
  }

  function renderPainelFornecedores() {
    const el = document.getElementById('painel-fornecedores');
    if (!el) return;
    const fornMap = {};
    state.empenhos.forEach(e => {
      const forn = e.credor || 'NÃO INFORMADO';
      if (!fornMap[forn]) fornMap[forn] = { doc: e.doc, aLiquidar: 0, count: 0 };
      fornMap[forn].count++;
      e.linhas.forEach(l => {
        fornMap[forn].aLiquidar += Number(l.aLiquidar || 0);
      });
    });

    const topForn = Object.entries(fornMap)
      .filter(x => x[1].aLiquidar > 0)
      .sort((a, b) => b[1].aLiquidar - a[1].aLiquidar)
      .slice(0, 8);

    el.innerHTML = `
      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th>Fornecedor</th>
              <th>CNPJ / CPF</th>
              <th class="center">NEs Ativas</th>
              <th class="num">Saldo a Liquidar</th>
              <th class="center">Ação</th>
            </tr>
          </thead>
          <tbody>
            ${topForn.map(([nome, d]) => `
              <tr>
                <td><strong>${nome}</strong></td>
                <td class="mono">${formatDoc(d.doc)}</td>
                <td class="center"><span class="badge b-gray">${d.count}</span></td>
                <td class="num pos"><strong>${formatMoeda(d.aLiquidar)}</strong></td>
                <td class="center">
                  <button class="btn btn-xs btn-primary" onclick="filtrarEmpenhosPorCredor('${nome.replace(/'/g, "\\'")}')">Ver Empenhos</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  // Navegação entre Abas
  window.navigateTab = function (tabId) {
    document.querySelectorAll('.nav-tab').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === tabId);
    });
    document.querySelectorAll('.tab-panel').forEach(p => {
      p.classList.toggle('active', p.id === tabId);
    });

    if (tabId === 'tab-painel') updateKPIs();
    if (tabId === 'tab-itens-empresa') carregarAbaItensEmpresa();
    if (tabId === 'tab-empenhos') renderTabelaEmpenhos();
    if (tabId === 'tab-envios') renderTabelaEnvios();
    if (tabId === 'tab-entregas') renderEntregas();
    if (tabId === 'tab-novo') renderNovoEmpenho();
    if (tabId === 'tab-nc') renderNotasCredito();
    if (tabId === 'tab-fornecedores') renderFornecedores();
    if (tabId === 'tab-config') renderConfig();
  };

  // ===== ABA: SALDO POR ITENS & EMPRESAS (BAIXA POR NOTA FISCAL) =====
  window._modoItensAtual = 'empresa';

  window.alternarModoItens = function (modo) {
    window._modoItensAtual = modo;
    document.getElementById('btn-modo-todos-itens')?.classList.toggle('active', modo === 'todos');
    document.getElementById('btn-modo-por-empresa')?.classList.toggle('active', modo === 'empresa');
    document.getElementById('btn-modo-quem')?.classList.toggle('active', modo === 'quem');
    aplicarFiltrosItens();
  };

  window.aplicarFiltrosItens = function () {
    const texto = (document.getElementById('item-search-filtro')?.value || '').trim();
    const selEmp = document.getElementById('sel-empresa-filtro')?.value || '';
    const soComSaldo = document.getElementById('chk-so-com-saldo')?.checked ?? true;

    if (window._modoItensAtual === 'quem') {
      renderQuemEntrega(texto, selEmp, soComSaldo);
    } else if (window._modoItensAtual === 'todos') {
      renderTodosOsItensAReceber(texto, selEmp, soComSaldo);
    } else {
      renderPorEmpresaEEmpenhos(texto, selEmp, soComSaldo);
    }
  };

  // ===== QUEM ENTREGA? (item -> empresa responsável -> telefone) =====
  function semAcento(s) {
    return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  }
  function soDigitos(s) { return String(s || '').replace(/\D/g, ''); }
  function escHtml(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  }

  function nomesParecidos(a, b) {
    const na = semAcento(a), nb = semAcento(b);
    if (na.length < 8 || nb.length < 8) return false;
    return na.includes(nb) || nb.includes(na) || na.slice(0, 18) === nb.slice(0, 18);
  }

  function formatarTelefone(t) {
    const d = soDigitos(t);
    if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
    if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return String(t || '');
  }

  function linksTelefone(t) {
    let d = soDigitos(t);
    if (d.length < 10) return null;
    if (!(d.startsWith('55') && d.length >= 12)) d = '55' + d;
    return { tel: 'tel:+' + d, wa: 'https://wa.me/' + d };
  }

  // Garante que todo fornecedor com CNPJ/CPF nos empenhos exista na lista de contatos
  function garantirContatosDosEmpenhos() {
    let criou = 0;
    state.empenhos.forEach(e => {
      const doc = soDigitos(e.doc);
      if (!doc || !e.credor) return;
      if (state.contatos.some(c => soDigitos(c.doc) === doc)) return;
      const porNome = state.contatos.find(c => !soDigitos(c.doc) && nomesParecidos(c.nome, e.credor));
      if (porNome) { porNome.doc = doc; return; }
      state.contatos.push({ nome: e.credor, doc: doc, endereco: '', email: '', telefone: '', responsavel: '' });
      criou++;
    });
    return criou;
  }

  function acharContatoDoEmpenho(emp, nomeFallback) {
    const doc = soDigitos(emp && emp.doc);
    let c = doc ? state.contatos.find(x => soDigitos(x.doc) === doc) : null;
    if (!c) c = state.contatos.find(x => nomesParecidos(x.nome, (emp && emp.credor) || nomeFallback));
    return c || null;
  }

  window.renderQuemEntrega = function (filtroTexto = '', filtroEmpresa = '', soComSaldo = true) {
    const container = document.getElementById('conteudo-itens-empresa');
    if (!container) return;

    const palavras = semAcento(filtroTexto).split(' ').filter(Boolean);
    const grupos = {};

    state.roteiros.forEach(r => {
      const emp = state.empenhos.find(e => e.ne === r.ne) || {};
      const empresa = emp.credor || normalizarNomeEmpresa(r.empresa || r.aba);
      if (filtroEmpresa && !semAcento(empresa).includes(semAcento(filtroEmpresa))) return;
      const contato = acharContatoDoEmpenho(emp, empresa);

      (r.itens || []).forEach(it => {
        const qtdTot = Number(it.qtdTotal || 0);
        const saldo = (it.saldoQtd !== null && it.saldoQtd !== undefined) ? Number(it.saldoQtd) : qtdTot;
        if (soComSaldo && saldo <= 0) return;
        const alvo = semAcento(it.desc + ' ' + empresa);
        if (palavras.length && !palavras.every(p => alvo.includes(p))) return;

        const chave = semAcento(it.desc);
        if (!grupos[chave]) grupos[chave] = { desc: String(it.desc || '').trim(), linhas: [] };
        grupos[chave].linhas.push({
          empresa: empresa, ne: r.ne, contato: contato,
          qtdTot: qtdTot, saldo: saldo, entregue: Math.max(0, qtdTot - saldo), vlUnit: Number(it.vlUnit || 0)
        });
      });
    });

    const lista = Object.values(grupos).sort((a, b) => a.desc.localeCompare(b.desc, 'pt-BR'));
    const empresasSet = new Set();
    (state.empresas || []).forEach(emp => { if (emp.nome) empresasSet.add(emp.nome.trim()); });
    lista.forEach(g => g.linhas.forEach(l => empresasSet.add(l.empresa)));

    let html = `
      <div class="callout info">
        <strong>📞 Acabou um item? Digite o nome dele na busca acima</strong> (ex.: <em>banana</em>, <em>leite</em>, <em>ovos</em>) e veja
        quais empresas ainda têm saldo no empenho para entregar, com telefone, WhatsApp e e-mail para o contato semanal.
        ${soComSaldo ? 'Mostrando só empresas com saldo no empenho.' : 'Mostrando também empenhos já entregues.'}
      </div>
      <div class="muted small" style="margin-bottom:.8rem;">${lista.length} item(ns) • ${empresasSet.size} empresa(s)</div>
    `;

    if (lista.length === 0) {
      container.innerHTML = html + `<div class="callout warn">Nenhum item encontrado${filtroTexto ? ' para "<strong>' + escHtml(filtroTexto) + '</strong>"' : ''}. Se o item existe mas está zerado, desmarque <em>"Só itens com saldo a receber"</em>.</div>`;
      return;
    }

    lista.forEach(g => {
      g.linhas.sort((a, b) => b.saldo - a.saldo);
      html += `
        <div class="group-card">
          <div class="group-head">
            <div>
              <div class="gh-title">${escHtml(g.desc)}</div>
              <div class="gh-sub">${g.linhas.length} empenho(s) • saldo total nos empenhos: <strong>${formatNumero(g.linhas.reduce((a, l) => a + l.saldo, 0))}</strong></div>
            </div>
          </div>
          <div class="group-body table-scroll">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Empresa respons\u00E1vel</th>
                  <th>Contato</th>
                  <th>Telefone</th>
                  <th>E-mail</th>
                  <th style="background:#162a1e; color:#fde68a;">Qual Empenho pagar\u00E1 a entrega?</th>
                  <th class="num" style="background:#162a1e; color:#fde68a;">Saldo Restante a Pedir</th>
                  <th class="num">Entregue / Total</th>
                  <th class="center">A\u00E7\u00E3o no Pedido</th>
                </tr>
              </thead>
              <tbody>
                ${g.linhas.map(l => {
                  const c = l.contato;
                  const idx = c ? state.contatos.indexOf(c) : -1;
                  const lk = c ? linksTelefone(c.telefone) : null;
                  const tel = c && c.telefone
                    ? `<strong>${escHtml(formatarTelefone(c.telefone))}</strong>
                       ${lk ? `<a class="btn btn-xs" href="${lk.tel}" title="Ligar">\u{1F4DE}</a> <a class="btn btn-xs btn-primary" href="${lk.wa}" target="_blank" rel="noopener" title="Abrir WhatsApp">\u{1F4AC}</a>` : ''}`
                    : '<span class="badge b-red">sem telefone</span>';
                  const mail = c && c.email
                    ? `<a href="mailto:${escHtml(c.email)}">${escHtml(c.email)}</a>`
                    : '<span class="muted small">\u2014</span>';
                  return `
                    <tr>
                      <td class="wrap"><strong>${escHtml(l.empresa)}</strong></td>
                      <td>${c && c.responsavel ? escHtml(c.responsavel) : '<span class="muted small">\u2014</span>'}</td>
                      <td>${tel}</td>
                      <td>${mail}</td>
                      <td>
                        <div style="display:flex; align-items:center; gap:0.4rem; flex-wrap:wrap;">
                          <span class="ne-code font-bold">${l.ne}</span>
                          ${l.saldo > 0 ? '<span class="badge b-green font-bold">\u{1F7E2} Indicar no Pedido</span>' : '<span class="badge b-gray">Finalizado</span>'}
                        </div>
                      </td>
                      <td class="num font-bold" style="background:#fef9e7; color:#854d0e;">
                        <span class="saldo-badge-gold">${formatNumero(l.saldo)}</span>
                        <div class="muted small" style="margin-top:0.2rem;">${formatMoeda(l.saldo * l.vlUnit)}</div>
                      </td>
                      <td class="num muted">${formatNumero(l.entregue)} / ${formatNumero(l.qtdTot)}</td>
                      <td class="center">
                        <button class="btn btn-xs btn-primary font-bold" onclick="selecionarEmpresaParaBaixa('${escHtml(l.empresa)}', '${l.ne}')" title="Indicar este empenho para pedido ou dar baixa">
                          \u{1F4E6} Indicar NE / Baixar
                        </button>
                      </td>
                    </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>`;
    });

    container.innerHTML = html;
  };

  // Busca e-mail/telefone que faltam na Receita Federal (só preenche campos vazios)
  window.buscarContatosFaltantes = async function () {
    const alvo = state.contatos.filter(c => soDigitos(c.doc).length === 14 && (!c.email || !c.telefone));
    if (!alvo.length) { showToast('Todos os fornecedores com CNPJ já têm e-mail e telefone.', 'ok'); return; }
    if (!confirm(`Buscar e-mail e telefone de ${alvo.length} fornecedor(es) na Receita Federal (BrasilAPI)?\nSó campos vazios serão preenchidos. Leva cerca de ${Math.max(1, Math.ceil(alvo.length * 1.3 / 60))} minuto(s).`)) return;
    const badge = document.getElementById('sync-badge');
    let ok = 0, semDado = 0, falha = 0;
    for (let i = 0; i < alvo.length; i++) {
      const c = alvo[i];
      if (badge) badge.textContent = `🔎 ${i + 1}/${alvo.length}`;
      try {
        const r = await fetch('https://brasilapi.com.br/api/cnpj/v1/' + soDigitos(c.doc));
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const d = await r.json();
        let mudou = false;
        if (!c.email && d.email) { c.email = String(d.email).toLowerCase(); mudou = true; }
        const tel = d.ddd_telefone_1 || d.ddd_telefone_2 || '';
        if (!c.telefone && soDigitos(tel).length >= 10) { c.telefone = formatarTelefone(tel); mudou = true; }
        if (mudou) ok++; else semDado++;
      } catch (e) { falha++; }
      await new Promise(res => setTimeout(res, 1300));
    }
    if (badge) badge.textContent = '💾 Local';
    saveState();
    renderFornecedores();
    showToast(`Busca concluída: ${ok} preenchidos, ${semDado} sem dados na Receita, ${falha} falhas.`, ok > 0 ? 'ok' : 'err');
  };

  window.carregarAbaItensEmpresa = function () {
    const sel = document.getElementById('sel-empresa-filtro');
    if (!sel) return;

    // Obtém todas as empresas distintas das planilhas e roteiros
    const empresasSet = new Set();
    state.roteiros.forEach(r => {
      const nome = normalizarNomeEmpresa(r.empresa || r.aba);
      if (nome) empresasSet.add(nome);
    });
    state.empenhos.forEach(e => {
      if (e.credor) empresasSet.add(e.credor.trim());
    });

    const empresas = Array.from(empresasSet).sort((a,b) => a.localeCompare(b));
    const valAtual = sel.value;

    sel.innerHTML = '<option value="">Todas as Empresas...</option>' + 
      empresas.map(emp => `<option value="${emp}" ${emp === valAtual ? 'selected' : ''}>${emp}</option>`).join('');

    aplicarFiltrosItens();
  };

  // Visão Consolidada: Todos os itens com a QUANTIDADE A RECEBER em destaque
  window.renderTodosOsItensAReceber = function (filtroTexto = '', filtroEmpresa = '', soComSaldo = true) {
    const container = document.getElementById('conteudo-itens-empresa');
    if (!container) return;

    let lista = [];
    state.roteiros.forEach(r => {
      const empNome = normalizarNomeEmpresa(r.empresa || r.aba);
      (r.itens || []).forEach((it, idx) => {
        const saldoQtd = it.saldoQtd !== null && it.saldoQtd !== undefined ? Number(it.saldoQtd) : Number(it.qtdTotal || 0);
        const qtdTot = Number(it.qtdTotal || 0);
        const entregue = Math.max(0, qtdTot - saldoQtd);
        const vlUnit = Number(it.vlUnit || 0);
        const saldoValor = saldoQtd * vlUnit;

        if (soComSaldo && saldoQtd <= 0) return;

        if (filtroEmpresa && !empNome.toLowerCase().includes(filtroEmpresa.toLowerCase())) return;

        if (filtroTexto) {
          const match = `${it.desc} ${empNome} ${r.ne}`.toLowerCase().includes(filtroTexto.toLowerCase());
          if (!match) return;
        }

        lista.push({
          desc: it.desc,
          ne: r.ne,
          empresa: empNome,
          qtdTotal: qtdTot,
          qtdEntregue: entregue,
          saldoQtd: saldoQtd,
          vlUnit: vlUnit,
          saldoValor: saldoValor,
          itemIdx: idx
        });
      });
    });

    // Ordena por maior saldo a receber
    lista.sort((a,b) => b.saldoQtd - a.saldoQtd);

    let totalQtdReceber = lista.reduce((acc, x) => acc + x.saldoQtd, 0);
    let totalValorReceber = lista.reduce((acc, x) => acc + x.saldoValor, 0);

    container.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem; flex-wrap:wrap; gap:1rem; background:var(--bg-elevated); padding:0.85rem 1.2rem; border-radius:var(--radius-sm); border:1px solid var(--border-color);">
        <div>
          <span style="font-size:0.95rem; font-weight:800; color:var(--bg-olive-dark);">
            📋 Lista Geral de Itens a Receber (${lista.length} itens encontrados)
          </span>
          <div class="muted small">Mostra a quantidade exata pendente de entrega por empenho</div>
        </div>
        <div style="display:flex; gap:1.5rem;">
          <div style="text-align:right;">
            <div class="small muted">Valor Total a Receber</div>
            <div class="font-bold mono pos" style="font-size:1.15rem;">${formatMoeda(totalValorReceber)}</div>
          </div>
        </div>
      </div>

      <div class="table-scroll tall">
        <table class="data-table">
          <thead>
            <tr>
              <th>Item / Gênero</th>
              <th>Nota de Empenho</th>
              <th>Empresa Fornecedora</th>
              <th class="num">Qtd Total Empenhada</th>
              <th class="num">Qtd Já Entregue</th>
              <th class="num" style="background:#162a1e; color:#fde68a; font-size:0.78rem;">QUANTIDADE A RECEBER (SALDO)</th>
              <th class="center" style="min-width:130px;">Progresso de Entrega</th>
              <th class="num">Valor Unit.</th>
              <th class="num">Saldo a Receber (R$)</th>
              <th class="center">Ação</th>
            </tr>
          </thead>
          <tbody>
            ${lista.length === 0 ? '<tr><td colspan="10" class="center muted py-4">Nenhum item encontrado com os filtros atuais.</td></tr>' : 
              lista.map(it => {
                const perc = it.qtdTotal > 0 ? Math.min(100, Math.round((it.qtdEntregue / it.qtdTotal) * 100)) : 0;
                return `
                  <tr>
                    <td class="desc" style="font-size:0.84rem;"><strong>${it.desc}</strong></td>
                    <td class="ne-code font-bold">${it.ne}</td>
                    <td class="wrap font-bold" style="color:var(--text-secondary);">${it.empresa}</td>
                    <td class="num">${formatNumero(it.qtdTotal)}</td>
                    <td class="num">${formatNumero(it.qtdEntregue)}</td>
                    <td class="num font-bold" style="background:#fef9e7; font-size:0.96rem; color:#854d0e;">
                      <strong>${formatNumero(it.saldoQtd)}</strong>
                    </td>
                    <td class="center">
                      <div class="progress ${perc === 100 ? '' : (perc > 40 ? 'info' : 'warn')}" title="${perc}% entregue">
                        <span style="width: ${perc}%;"></span>
                      </div>
                      <div style="font-size:0.68rem; color:var(--text-muted); margin-top:0.2rem;">${perc}% entregue (${formatNumero(it.qtdEntregue)} / ${formatNumero(it.qtdTotal)})</div>
                    </td>
                    <td class="num muted">${formatMoeda(it.vlUnit)}</td>
                    <td class="num font-bold pos">${formatMoeda(it.saldoValor)}</td>
                    <td class="center">
                      <button class="btn btn-xs btn-primary" onclick="selecionarEmpresaParaBaixa('${it.empresa.replace(/'/g, "\\'")}', '${it.ne}')">
                        📥 Dar Baixa por NF
                      </button>
                    </td>
                  </tr>
                `;
              }).join('')}
          </tbody>
        </table>
      </div>
    `;
  };

  function normalizarNomeEmpresa(str) {
    if (!str) return '';
    return str.replace(/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\s*[-–]\s*/, '').trim();
  }

  // Toggle do catÃ¡logo de itens homologados no PregÃ£o
  // Toggle do cat\u00E1logo de itens homologados no Preg\u00E3o
  window.toggleCatalogoPregao = function (id) {
    const el = document.getElementById(`pregao-cat-${id}`);
    const btn = document.getElementById(`btn-toggle-pregao-${id}`);
    if (el) {
      const isHidden = el.style.display === 'none';
      el.style.display = isHidden ? 'block' : 'none';
      if (btn) btn.innerHTML = isHidden ? '\u{1F4E6} Ocultar Cat\u00E1logo do Preg\u00E3o QR \u25B2' : '\u{1F4E6} Ver Itens Homologados no Preg\u00E3o QR \u25BC';
    }
  };

  // Helper para obter lista completa e atualizada de empresas com seus empenhos e itens
  function obterEmpresasConsolidadas() {
    const mapa = new Map();

    // 1. Base pr\u00E9-estruturada
    (state.empresas || []).forEach(emp => {
      mapa.set(emp.chave || emp.nome, JSON.parse(JSON.stringify(emp)));
    });

    // 2. Mescla com roteiros ativos (mant\u00E9m hist\u00F3rico mais recente)
    state.roteiros.forEach(r => {
      const empTesouro = state.empenhos.find(e => e.ne === r.ne) || {};
      const empNome = empTesouro.credor || normalizarNomeEmpresa(r.empresa || r.aba);
      const doc = soDigitos(empTesouro.doc || r.cnpj);

      let found = null;
      for (let e of mapa.values()) {
        if ((doc && e.cnpj && soDigitos(e.cnpj) === doc) || nomesParecidos(e.nome, empNome) || (e.aba && e.aba === r.aba)) {
          found = e; break;
        }
      }

      if (!found) {
        found = {
          chave: doc || empNome,
          aba: r.aba || '',
          nome: empNome,
          cnpj: doc || '',
          cnpjFormatado: formatDoc(doc),
          endereco: '',
          email: '',
          telefone: '',
          responsavel: '',
          totalEmpenhado: 0,
          totalSaldo: 0,
          empenhos: [],
          itensPregao: []
        };
        mapa.set(found.chave, found);
      }

      // Atualiza ou insere o empenho
      const idxNE = (found.empenhos || []).findIndex(x => x.ne === r.ne);
      const aLiqTesouro = empTesouro.linhas ? empTesouro.linhas.reduce((acc,l)=>acc+Number(l.aLiquidar||0),0) : (r.saldoNE || 0);
      const totNETesouro = r.totalNE || (empTesouro.linhas ? empTesouro.linhas.reduce((acc,l)=>acc+Number(l.aLiquidar||0)+Number(l.liquidadoAPagar||0)+Number(l.pago||0),0) : 0);
      
      const neObj = {
        ne: r.ne,
        aba: r.aba,
        tag: r.tag,
        ug: empTesouro.ug || '160462',
        pi: empTesouro.pi || 'E6SUPLJA1QR',
        dataEmissao: empTesouro.data || '',
        totalNE: totNETesouro,
        totalNF: r.totalNF || (totNETesouro - aLiqTesouro),
        saldoNE: r.saldoNE !== null && r.saldoNE !== undefined ? r.saldoNE : aLiqTesouro,
        situacao: r.situacao || (aLiqTesouro <= 0 ? 'FINALIZADO' : 'AINDA H\u00C1 SALDO'),
        itens: r.itens || [],
        entregas: r.entregas || []
      };

      if (idxNE >= 0) {
        found.empenhos[idxNE] = neObj;
      } else {
        found.empenhos.push(neObj);
      }
    });

    // 3. Mescla contatos mais recentes
    for (let e of mapa.values()) {
      const c = acharContatoDoEmpenho({ doc: e.cnpj, credor: e.nome }, e.nome);
      if (c) {
        if (!e.telefone && c.telefone) e.telefone = c.telefone;
        if (!e.email && c.email) e.email = c.email;
        if (!e.responsavel && c.responsavel) e.responsavel = c.responsavel;
        if (!e.endereco && c.endereco) e.endereco = c.endereco;
      }
      // Vincula itens do preg\u00E3o se houver
      if (!e.itensPregao || !e.itensPregao.length) {
        e.itensPregao = (state.itensPregao || []).filter(it => {
          return (e.cnpj && soDigitos(it.cnpj) === soDigitos(e.cnpj)) || nomesParecidos(it.fornecedor, e.nome);
        });
      }
    }

    return Array.from(mapa.values());
  }

  // RENDERIZA\u00C7\u00C3O HIER\u00C1RQUICA: Empresa -> Empenhos vinculados -> Itens e Saldo a Pedir
  window.renderPorEmpresaEEmpenhos = function (filtroTexto = '', filtroEmpresa = '', soComSaldo = true) {
    const container = document.getElementById('conteudo-itens-empresa');
    if (!container) return;

    const empresas = obterEmpresasConsolidadas();
    const palavras = semAcento(filtroTexto).split(' ').filter(Boolean);

    // Filtra empresas
    const filtradas = empresas.filter(emp => {
      if (filtroEmpresa && !semAcento(emp.nome).includes(semAcento(filtroEmpresa)) && emp.nome !== filtroEmpresa) {
        return false;
      }

      // Calcula saldos totais
      const totSaldo = (emp.empenhos || []).reduce((acc, ne) => acc + Number(ne.saldoNE || 0), 0);
      const temSaldo = totSaldo > 0 || (emp.empenhos || []).some(ne => (ne.itens || []).some(it => Number(it.saldoQtd || 0) > 0));

      if (soComSaldo && !temSaldo) return false;

      if (palavras.length) {
        let textoBusca = `${emp.nome} ${emp.cnpj} ${emp.responsavel} ${emp.telefone} ${emp.email} `;
        (emp.empenhos || []).forEach(ne => {
          textoBusca += `${ne.ne} ${ne.tag} ${ne.pi} `;
          (ne.itens || []).forEach(it => { textoBusca += `${it.desc} `; });
        });
        (emp.itensPregao || []).forEach(it => { textoBusca += `${it.descricao} `; });
        const textoNorm = semAcento(textoBusca);
        if (!palavras.every(p => textoNorm.includes(p))) return false;
      }

      return true;
    });

    // Ordena: empresas com saldo primeiro, depois por nome
    filtradas.sort((a, b) => {
      const sA = (a.empenhos || []).reduce((acc, ne) => acc + Number(ne.saldoNE || 0), 0);
      const sB = (b.empenhos || []).reduce((acc, ne) => acc + Number(ne.saldoNE || 0), 0);
      if (sB !== sA) return sB - sA;
      return a.nome.localeCompare(b.nome, 'pt-BR');
    });

    let totalNEsFiltradas = 0;
    let totalSaldoGeral = 0;
    filtradas.forEach(e => {
      (e.empenhos || []).forEach(ne => {
        totalNEsFiltradas++;
        totalSaldoGeral += Number(ne.saldoNE || 0);
      });
    });

    let html = `
      <div class="callout info mb-3">
        <strong>\u{1F3E2} Organiza\u00E7\u00E3o por Empresa &amp; Empenhos:</strong> Visualize quais Notas de Empenho pertencem a cada empresa fornecedora e quais itens foram empenhados.
        Na hora do pedido semanal de rancho, identifique instantaneamente <strong>qual empenho pagar\u00E1 a entrega</strong> e o <strong>saldo a pedir</strong> restante.
      </div>
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem; flex-wrap:wrap; gap:1rem;">
        <div class="muted small">
          Exibindo <strong>${filtradas.length}</strong> empresa(s) \u2022 <strong>${totalNEsFiltradas}</strong> empenho(s) \u2022 Saldo total nos empenhos: <strong class="pos font-bold">${formatMoeda(totalSaldoGeral)}</strong>
        </div>
      </div>
    `;

    if (filtradas.length === 0) {
      container.innerHTML = html + `
        <div class="callout warn py-4 center">
          Nenhuma empresa encontrada com os filtros atuais.
          ${filtroTexto ? `<br>Busca por: "<strong>${escHtml(filtroTexto)}</strong>".` : ''}
          ${soComSaldo ? '<br>Tente desmarcar <em>"S\u00F3 itens com saldo a receber"</em> para visualizar empresas com empenhos j\u00E1 finalizados.' : ''}
        </div>
      `;
      return;
    }

    filtradas.forEach((emp, empIdx) => {
      const c = emp;
      const lk = linksTelefone(c.telefone);
      const telHtml = c.telefone
        ? `<strong>${escHtml(formatarTelefone(c.telefone))}</strong>
           ${lk ? `<a class="btn btn-xs" href="${lk.tel}" title="Ligar">\u{1F4DE}</a> <a class="btn btn-xs btn-primary" href="${lk.wa}" target="_blank" rel="noopener" title="Abrir WhatsApp">\u{1F4AC}</a>` : ''}`
        : '<span class="badge b-red">Sem telefone</span>';
      const mailHtml = c.email
        ? `<a href="mailto:${escHtml(c.email)}" class="font-bold">${escHtml(c.email)}</a>`
        : '<span class="muted small">Sem e-mail</span>';

      const totEmpresaSaldo = (emp.empenhos || []).reduce((acc, ne) => acc + Number(ne.saldoNE || 0), 0);
      const totEmpresaValor = (emp.empenhos || []).reduce((acc, ne) => acc + Number(ne.totalNE || 0), 0);
      const temSaldo = totEmpresaSaldo > 0;

      html += `
        <div class="empresa-card" id="card-empresa-${emp.chave || empIdx}">
          <!-- CABE\u00C7ALHO DA EMPRESA -->
          <div class="empresa-card-header">
            <div>
              <div class="empresa-card-title">
                \u{1F3E2} ${escHtml(emp.nome)}
                <span class="mono small muted font-bold" style="font-size:0.8rem; font-weight:600;">(${formatDoc(emp.cnpj)})</span>
                ${temSaldo ? `<span class="badge b-green font-bold">\u{1F7E2} Saldo a Liquidar: ${formatMoeda(totEmpresaSaldo)}</span>` : `<span class="badge b-gray">\u26AA Empenhos Finalizados</span>`}
              </div>
            </div>
            <div style="display:flex; gap:0.6rem; align-items:center; flex-wrap:wrap;">
              <span class="badge b-purple font-bold">\u{1F4D1} ${emp.empenhos.length} Nota(s) de Empenho</span>
              ${emp.itensPregao && emp.itensPregao.length ? `<span class="badge b-blue font-bold">\u{1F4E6} ${emp.itensPregao.length} itens no Preg\u00E3o</span>` : ''}
              <div style="text-align:right; margin-left:0.5rem;">
                <div class="small muted">Total Empenhado</div>
                <div class="font-bold mono" style="font-size:0.95rem;">${formatMoeda(totEmpresaValor)}</div>
              </div>
            </div>
          </div>

          <!-- BARRA DE CONTATOS DIRETOS -->
          <div class="empresa-contatos-strip">
            <div>\u{1F464} <strong>Contato:</strong> ${c.responsavel ? escHtml(c.responsavel) : '<span class="muted">\u2014</span>'}</div>
            <div>\u{1F4DE} <strong>Telefone:</strong> ${telHtml}</div>
            <div>\u2709\uFE0F <strong>E-mail:</strong> ${mailHtml}</div>
            ${c.endereco ? `<div>\u{1F4CD} <strong>Endere\u00E7o:</strong> <span class="muted">${escHtml(c.endereco)}</span></div>` : ''}
          </div>

          <!-- EMPENHOS SOB RESPONSABILIDADE DESTA EMPRESA -->
          <div class="empresa-empenhos-container">
            <div style="font-weight:800; font-size:0.9rem; color:var(--bg-olive-dark); display:flex; justify-content:space-between; align-items:center;">
              <span>\u{1F4D1} Notas de Empenho vinculadas a esta empresa (${emp.empenhos.length}):</span>
              <span class="small muted">Indique o empenho com saldo ativo ao solicitar a entrega</span>
            </div>

            ${(emp.empenhos || []).length === 0 ? '<div class="muted small py-2">Nenhuma nota de empenho associada a esta empresa.</div>' : 
              emp.empenhos.map((r) => {
                const aLiq = Number(r.saldoNE || 0);
                const totNE = Number(r.totalNE || 0);
                const totBaixado = Math.max(0, totNE - aLiq);
                const isFinalizado = aLiq <= 0;

                return `
                  <div class="empenho-subcard ${isFinalizado ? 'finalizado' : ''}" id="card-ne-${r.ne}">
                    <div class="empenho-subcard-header">
                      <div>
                        <div style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;">
                          <span class="ne-code font-bold" style="font-size:1.05rem;">\u{1F4D1} ${r.ne}</span>
                          ${r.tag ? `<span class="badge b-purple font-bold">${r.tag}</span>` : ''}
                          ${!isFinalizado ? '<span class="badge b-yellow font-bold">\u{1F7E2} AINDA H\u00C1 SALDO (Ativo para Pedido)</span>' : '<span class="badge b-green">\u26AA Finalizado</span>'}
                        </div>
                        <div class="small muted" style="margin-top:0.2rem;">
                          UG: ${r.ug || '160462'} \u2022 PI: <strong>${r.pi || 'E6SUPLJA1QR'}</strong> \u2022 Emiss\u00E3o: ${formatData(r.dataEmissao)}
                        </div>
                      </div>
                      <div style="display:flex; gap:1.2rem; align-items:center; flex-wrap:wrap;">
                        <div style="text-align:right;">
                          <div class="small muted">Valor do Empenho</div>
                          <div class="font-bold mono">${formatMoeda(totNE)}</div>
                        </div>
                        <div style="text-align:right;">
                          <div class="small muted">J\u00E1 Baixado</div>
                          <div class="font-bold mono text-secondary">${formatMoeda(totBaixado)}</div>
                        </div>
                        <div style="text-align:right;">
                          <div class="small muted" style="color:var(--danger); font-weight:800;">SALDO A LIQUIDAR</div>
                          <div class="font-bold mono pos" style="font-size:1.15rem;">${formatMoeda(aLiq)}</div>
                        </div>
                      </div>
                    </div>

                    <div style="padding:0.9rem 1rem;">
                      <!-- TABELA DE ITENS DESTE EMPENHO -->
                      <h4 class="section-title" style="font-size:0.82rem; margin-bottom:0.4rem;">
                        \u{1F4E6} Itens empenhados nesta NE (informar esta NE no pedido semanal):
                      </h4>
                      <div class="table-scroll mb-3">
                        <table class="data-table">
                          <thead>
                            <tr>
                              <th>Item / G\u00EAnero Aliment\u00EDcio</th>
                              <th class="num">Qtd Empenhada</th>
                              <th class="num">Valor Unit.</th>
                              <th class="num">Total do Item</th>
                              <th class="num">Qtd J\u00E1 Entregue</th>
                              <th class="num" style="background:#162a1e; color:#fde68a;">SALDO A PEDIR (Qtd)</th>
                              <th class="num" style="background:#162a1e; color:#fde68a;">Saldo Restante (R$)</th>
                              <th class="center" style="background:#1f3d2b; color:#fff; min-width:140px;">Qtd Entregue nesta NF</th>
                            </tr>
                          </thead>
                          <tbody>
                            ${(r.itens || []).length === 0 ? '<tr><td colspan="8" class="center muted py-2">Itens n\u00E3o discriminados individualmente na planilha para esta NE. Baixa dispon\u00EDvel pelo valor total da NF abaixo.</td></tr>' : 
                              r.itens.map((it, itemIdx) => {
                                const saldoQtd = it.saldoQtd !== null && it.saldoQtd !== undefined ? Number(it.saldoQtd) : Number(it.qtdTotal || 0);
                                const saldoValor = Number(saldoQtd) * Number(it.vlUnit || 0);
                                const entregueQtd = Number(it.qtdTotal || 0) - Number(saldoQtd);

                                return `
                                  <tr>
                                    <td class="desc"><strong>${it.desc}</strong></td>
                                    <td class="num font-bold">${formatNumero(it.qtdTotal)}</td>
                                    <td class="num">${formatMoeda(it.vlUnit)}</td>
                                    <td class="num muted">${formatMoeda((it.qtdTotal || 0) * (it.vlUnit || 0))}</td>
                                    <td class="num">${formatNumero(entregueQtd)}</td>
                                    <td class="num font-bold" style="background:#fef9e7;">
                                      <span class="saldo-badge-gold">${formatNumero(saldoQtd)}</span>
                                    </td>
                                    <td class="num font-bold ${saldoValor > 0 ? 'pos' : 'muted'}">${formatMoeda(saldoValor)}</td>
                                    <td class="center" style="background:#f8faf7;">
                                      <input type="number" step="any" min="0" max="${saldoQtd}" 
                                        class="input-control num-input inp-baixa-qtd" 
                                        id="baixa-qtd-${r.ne}-${itemIdx}" 
                                        data-ne="${r.ne}" 
                                        data-item-idx="${itemIdx}" 
                                        data-vl-unit="${it.vlUnit || 0}" 
                                        placeholder="0" 
                                        oninput="calcularSubtotalNF('${r.ne}')" />
                                      <button class="btn btn-xs" type="button" title="Preencher saldo total restante" 
                                        onclick="document.getElementById('baixa-qtd-${r.ne}-${itemIdx}').value = ${saldoQtd}; calcularSubtotalNF('${r.ne}');">Max</button>
                                    </td>
                                  </tr>
                                `;
                              }).join('')}
                          </tbody>
                        </table>
                      </div>

                      <!-- PAINEL DE REGISTRO DA NOTA FISCAL -->
                      <div style="background:var(--bg-elevated); border:1px solid var(--border-color); border-radius:var(--radius-sm); padding:0.8rem 1rem; margin-bottom:1rem;">
                        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.8rem;">
                          <div style="display:flex; align-items:center; gap:0.8rem; flex-wrap:wrap;">
                            <div class="field">
                              <label style="font-size:0.75rem;">N\u00FAmero da Nota Fiscal (NF)</label>
                              <input type="text" id="nf-num-${r.ne}" class="input-control font-bold" placeholder="Ex: 8542" style="min-width:130px;" />
                            </div>
                            <div class="field">
                              <label style="font-size:0.75rem;">Data de Recebimento</label>
                              <input type="date" id="nf-data-${r.ne}" class="input-control" value="${new Date().toISOString().split('T')[0]}" />
                            </div>
                            <div class="field">
                              <label style="font-size:0.75rem;">Valor Total da NF Calculado</label>
                              <div id="nf-total-calc-${r.ne}" class="font-bold mono pos" style="font-size:1.1rem; padding:0.2rem 0;">R$ 0,00</div>
                            </div>
                          </div>
                          <div>
                            <button class="btn btn-primary" onclick="confirmarBaixaItensNF('${r.ne}')">
                              \u{1F4BE} Confirmar Baixa da NF nesta NE
                            </button>
                          </div>
                        </div>
                      </div>

                      <!-- HIST\u00D3RICO DE ENTREGAS DESTE EMPENHO -->
                      ${(r.entregas || []).length > 0 ? `
                        <details style="margin-top:0.4rem;">
                          <summary style="font-size:0.76rem; font-weight:700; color:var(--text-secondary); cursor:pointer;">
                            \u{1F69A} Ver hist\u00F3rico de entregas anteriores desta NE (${r.entregas.length} entrega(s) registrada(s))
                          </summary>
                          <div class="table-scroll" style="margin-top:0.4rem;">
                            <table class="data-table">
                              <thead>
                                <tr>
                                  <th>Data</th>
                                  <th>N\u00BA Nota Fiscal</th>
                                  <th class="num">Valor da NF</th>
                                  <th class="center">Status</th>
                                </tr>
                              </thead>
                              <tbody>
                                ${r.entregas.map(ent => `
                                  <tr>
                                    <td>${formatData(ent.data || ent.dataTxt)}</td>
                                    <td class="mono font-bold">${ent.nfNum ? `NF ${ent.nfNum}` : '-'}</td>
                                    <td class="num font-bold">${formatMoeda(ent.nfValor)}</td>
                                    <td class="center"><span class="badge ${ent.status === 'PAGO' ? 'b-green' : 'b-blue'}">${ent.status || 'Liquidada'}</span></td>
                                  </tr>
                                `).join('')}
                              </tbody>
                            </table>
                          </div>
                        </details>
                      ` : ''}

                    </div>
                  </div>
                `;
              }).join('')}
          </div>

          <!-- SE\u00C7\u00C3O DO CAT\u00C1LOGO DO PREG\u00C3O QR -->
          ${emp.itensPregao && emp.itensPregao.length ? `
            <div style="padding:0.6rem 1.2rem 1rem 1.2rem; border-top:1px dashed var(--border-color); background:#fafbf9;">
              <button class="pregao-collapse-btn" id="btn-toggle-pregao-${emp.chave || empIdx}" onclick="toggleCatalogoPregao('${emp.chave || empIdx}')">
                \u{1F4E6} Ver Itens Homologados no Preg\u00E3o QR (${emp.itensPregao.length} itens do contrato) \u25BC
              </button>
              <div id="pregao-cat-${emp.chave || empIdx}" style="display:none; margin-top:0.6rem;">
                <div class="small muted mb-2">Itens homologados e adjudicados para este fornecedor no Preg\u00E3o QR:</div>
                <div class="table-scroll">
                  <table class="data-table">
                    <thead>
                      <tr>
                        <th style="width:70px;">N\u00BA Item</th>
                        <th>Descri\u00E7\u00E3o Detalhada</th>
                        <th>Unidade</th>
                        <th class="num">Qtd Homologada</th>
                        <th class="num">Valor Unit. (R$)</th>
                        <th class="num">Valor Total Homologado</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${emp.itensPregao.map(it => `
                        <tr>
                          <td class="center font-bold">#${it.numeroItem || '-'}</td>
                          <td class="desc"><strong>${escHtml(it.descricao)}</strong></td>
                          <td>${escHtml(it.unidade || '-')}</td>
                          <td class="num font-bold">${formatNumero(it.qtdHomologada)}</td>
                          <td class="num">${formatMoeda(it.vlUnitario)}</td>
                          <td class="num font-bold">${formatMoeda(it.vlTotal)}</td>
                        </tr>
                      `).join('')}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ` : ''}

        </div>
      `;
    });

    container.innerHTML = html;
  };

  // Redireciona a renderiza\u00E7\u00E3o por empresa para a visualiza\u00E7\u00E3o hier\u00E1rquica unificada
  window.renderItensEmpresa = function (empresaNome) {
    window._modoItensAtual = 'empresa';
    document.getElementById('btn-modo-todos-itens')?.classList.remove('active');
    document.getElementById('btn-modo-quem')?.classList.remove('active');
    document.getElementById('btn-modo-por-empresa')?.classList.add('active');
    renderPorEmpresaEEmpenhos('', empresaNome, false);
  };
  window.calcularSubtotalNF = function (ne) {
    const inputs = document.querySelectorAll(`input.inp-baixa-qtd[data-ne="${ne}"]`);
    let total = 0;
    inputs.forEach(inp => {
      const qtd = parseFloat(inp.value) || 0;
      const unit = parseFloat(inp.dataset.vlUnit) || 0;
      total += (qtd * unit);
    });
    const label = document.getElementById(`nf-total-calc-${ne}`);
    if (label) label.innerText = formatMoeda(total);
  };

  // Confirmação da baixa por itens
  window.confirmarBaixaItensNF = function (ne) {
    const nfNum = document.getElementById(`nf-num-${ne}`)?.value.trim();
    const nfData = document.getElementById(`nf-data-${ne}`)?.value;

    if (!nfNum) {
      alert('Por favor, informe o número da Nota Fiscal (NF).');
      return;
    }

    const rot = state.roteiros.find(r => r.ne === ne);
    if (!rot) return;
    const emp = state.empenhos.find(e => e.ne === ne);

    const inputs = document.querySelectorAll(`input.inp-baixa-qtd[data-ne="${ne}"]`);
    let totalValorNF = 0;
    let itensEntregues = [];

    inputs.forEach(inp => {
      const itemIdx = parseInt(inp.dataset.itemIdx);
      const qtdEntregue = parseFloat(inp.value) || 0;
      if (qtdEntregue > 0 && rot.itens && rot.itens[itemIdx]) {
        const it = rot.itens[itemIdx];
        const unit = Number(it.vlUnit || 0);
        totalValorNF += (qtdEntregue * unit);

        // Abate da quantidade do saldo do item
        if (it.saldoQtd !== null && it.saldoQtd !== undefined) {
          it.saldoQtd = Math.max(0, Number(it.saldoQtd) - qtdEntregue);
        } else {
          it.saldoQtd = Math.max(0, (it.qtdTotal || 0) - qtdEntregue);
        }

        itensEntregues.push({ desc: it.desc, qtd: qtdEntregue, vlUnit: unit, subtotal: qtdEntregue * unit });
      }
    });

    if (totalValorNF <= 0) {
      alert('Por favor, informe a quantidade entregue de pelo menos um item.');
      return;
    }

    // Abate o valor total da NF no valor a liquidar do empenho
    if (emp && emp.linhas && emp.linhas.length > 0) {
      let restante = totalValorNF;
      for (let l of emp.linhas) {
        if (l.aLiquidar >= restante) {
          l.aLiquidar -= restante;
          l.liquidadoAPagar = (l.liquidadoAPagar || 0) + restante;
          restante = 0;
          break;
        } else {
          restante -= l.aLiquidar;
          l.liquidadoAPagar = (l.liquidadoAPagar || 0) + l.aLiquidar;
          l.aLiquidar = 0;
        }
      }
    }

    // Atualiza saldoNE no roteiro
    if (rot.saldoNE !== null && rot.saldoNE !== undefined) {
      rot.saldoNE = Math.max(0, rot.saldoNE - totalValorNF);
    }

    // Registra a nova entrega
    rot.entregas = rot.entregas || [];
    rot.entregas.push({
      slot: rot.entregas.length,
      data: nfData,
      dataTxt: formatData(nfData),
      nfNum: nfNum,
      nfValor: totalValorNF,
      status: 'Liquidada',
      itensDetalhados: itensEntregues
    });

    saveState();
    showToast(`Nota Fiscal ${nfNum} de ${formatMoeda(totalValorNF)} baixada com sucesso no empenho ${ne}!`, 'ok');
    
    // Recarrega a visualização da empresa atual
    const selEmp = document.getElementById('sel-empresa-filtro')?.value;
    renderItensEmpresa(selEmp);
  };

  window.confirmarBaixaEmpenhoSemItens = function (ne) {
    const nfNum = document.getElementById(`nf-num-${ne}`)?.value.trim();
    const nfData = document.getElementById(`nf-data-${ne}`)?.value;
    const valor = parseFloat(document.getElementById(`nf-val-${ne}`)?.value || '0');

    if (!nfNum || valor <= 0) {
      alert('Informe o número da NF e um valor válido.');
      return;
    }

    const emp = state.empenhos.find(e => e.ne === ne);
    if (!emp) return;

    // Abate do empenho
    if (emp.linhas && emp.linhas.length > 0) {
      let restante = valor;
      for (let l of emp.linhas) {
        if (l.aLiquidar >= restante) {
          l.aLiquidar -= restante;
          l.liquidadoAPagar = (l.liquidadoAPagar || 0) + restante;
          restante = 0;
          break;
        } else {
          restante -= l.aLiquidar;
          l.liquidadoAPagar = (l.liquidadoAPagar || 0) + l.aLiquidar;
          l.aLiquidar = 0;
        }
      }
    }

    // Registra entrega em roteiro (cria se não existir)
    let rot = state.roteiros.find(r => r.ne === ne);
    if (!rot) {
      rot = { ne: ne, empresa: emp.credor, itens: [], entregas: [] };
      state.roteiros.push(rot);
    }
    rot.entregas = rot.entregas || [];
    rot.entregas.push({
      slot: rot.entregas.length,
      data: nfData,
      dataTxt: formatData(nfData),
      nfNum: nfNum,
      nfValor: valor,
      status: 'Liquidada'
    });

    saveState();
    showToast(`NF ${nfNum} de ${formatMoeda(valor)} baixada com sucesso no empenho ${ne}!`, 'ok');
    const selEmp = document.getElementById('sel-empresa-filtro')?.value;
    renderItensEmpresa(selEmp);
  };

  window.filtrarItensBusca = function (termo) {
    aplicarFiltrosItens();
  };

  window.selecionarEmpresaParaBaixa = function (empresa, ne) {
    const sel = document.getElementById('sel-empresa-filtro');
    if (sel) {
      sel.value = empresa;
      renderItensEmpresa(empresa);
      setTimeout(() => {
        const el = document.getElementById(`card-ne-${ne}`);
        if (el) el.scrollIntoView({ behavior: 'smooth' });
      }, 200);
    }
  };

  window.expandirTodosEmpenhos = function () {
    const cards = document.querySelectorAll('[id^="card-ne-"]');
    cards.forEach(c => c.scrollIntoView({ behavior: 'smooth' }));
  };
  // ===== FIM DA ABA: SALDO POR ITENS & EMPRESAS =====

  // Render Tabela Empenhos
  function renderTabelaEmpenhos() {
    const tableEl = document.getElementById('ne-table');
    const filterText = (document.getElementById('ne-filter-text')?.value || '').toLowerCase();
    const filterResp = (document.getElementById('ne-filter-resp')?.value || 'APROV').toUpperCase();
    const filterAno = document.getElementById('ne-filter-ano')?.value || '2026';
    const filterSit = document.getElementById('ne-filter-sit')?.value || 'abertos';
    const filterPi = document.getElementById('ne-filter-pi')?.value || '';

    // Popula dropdown de Plano Interno
    const pis = Array.from(new Set(state.empenhos.map(e => e.pi))).filter(Boolean).sort();
    const piSelect = document.getElementById('ne-filter-pi');
    if (piSelect && piSelect.children.length <= 1) {
      pis.forEach(pi => {
        const opt = document.createElement('option');
        opt.value = pi;
        opt.innerText = pi;
        piSelect.appendChild(opt);
      });
    }

    let filtrados = state.empenhos.filter(e => {
      // 1. Filtro por Seção Responsável (Padrão: APROV / Rancho)
      const resp = (e.responsavel || 'APROV').toUpperCase();
      if (filterResp !== 'TODAS' && resp !== filterResp) return false;

      // 2. Filtro por Ano / Exercício (2026 / 2025 RPNP)
      const anoEmp = String(e.ano || (e.ne.startsWith('2025') ? '2025' : '2026'));
      if (filterAno !== 'todos' && anoEmp !== filterAno) return false;

      // 3. Filtro por Situação de Saldo
      const aLiq = e.linhas ? e.linhas.reduce((acc, l) => acc + Number(l.aLiquidar || 0), 0) : Number(e.aLiquidar || 0);
      if (filterSit === 'abertos' && aLiq <= 0) return false;
      if (filterSit === 'concluidos' && aLiq > 0) return false;
      if (filterPi && e.pi !== filterPi) return false;

      // 4. Busca textual
      if (filterText) {
        const str = `${e.ne} ${e.credor} ${e.doc} ${e.pi} ${e.responsavel || ''} ${e.status || ''} ${e.descricao || ''}`.toLowerCase();
        return str.includes(filterText);
      }
      return true;
    });

    let somaALiq = 0;
    let somaLiq = 0;
    let somaPago = 0;

    let rowsHtml = filtrados.map(e => {
      const totALiq = e.linhas ? e.linhas.reduce((acc, l) => acc + Number(l.aLiquidar || 0), 0) : Number(e.aLiquidar || 0);
      const totLiq = e.linhas ? e.linhas.reduce((acc, l) => acc + Number(l.liquidadoAPagar || 0), 0) : 0;
      const totP = e.linhas ? e.linhas.reduce((acc, l) => acc + Number(l.pago || 0), 0) : Number(e.pago || 0);
      const totGeral = totALiq + totLiq + totP;

      somaALiq += totALiq;
      somaLiq += totLiq;
      somaPago += totP;

      const dias = e.dataEnvio ? getDiasDecorridos(e.dataEnvio) : null;
      let statusBadge = '';
      if (totALiq <= 0) {
        statusBadge = '<span class="badge b-green">Totalmente Liquidado</span>';
      } else if (e.status === 'PROC ADM') {
        statusBadge = '<span class="badge b-red">\u2696\uFE0F Proc. Adm</span>';
      } else if (e.status === 'ENVIADO PARA LIQUIDAR') {
        statusBadge = '<span class="badge b-blue">\u{1F4E6} Env. Liquidar</span>';
      } else if (e.status === 'A RECEBER EMPENHO') {
        statusBadge = '<span class="badge b-yellow">\u{1F4DD} A Receber</span>';
      } else if (dias !== null) {
        if (dias > state.config.prazoProcessoDias) {
          statusBadge = `<span class="badge b-red">\u2696\uFE0F Proc. Adm (${dias}d)</span>`;
        } else if (dias > state.config.prazoReenvioDias) {
          statusBadge = `<span class="badge b-yellow">\u{1F501} Reenviar (${dias}d)</span>`;
        } else {
          statusBadge = `<span class="badge b-blue">\u23F3 No Prazo (${dias}d)</span>`;
        }
      } else {
        statusBadge = `<span class="badge b-gray">${escHtml(e.status || 'Não Enviado')}</span>`;
      }

      // Link para o espelho PDF oficial no Drive
      let pdfLink = '';
      if (e.drivePdf && e.drivePdf.viewUrl) {
        pdfLink = `<a href="${e.drivePdf.viewUrl}" target="_blank" rel="noopener" class="badge b-purple font-bold" onclick="event.stopPropagation()" title="Abrir espelho oficial em PDF da Nota de Empenho no Google Drive" style="text-decoration:none; margin-left:0.35rem;">\u{1F4C4} PDF</a>`;
      }

      return `
        <tr class="clickable" onclick="abrirDetalheNE('${e.ne}')">
          <td class="ne-code">
            <div style="display:flex; align-items:center; gap:0.25rem; flex-wrap:wrap;">
              <strong>${e.ne}</strong>
              ${pdfLink}
            </div>
          </td>
          <td><span class="badge ${e.responsavel === 'APROV' ? 'b-gold font-bold' : 'b-gray'}">${escHtml(e.responsavel || 'APROV')}</span></td>
          <td>
            <span class="badge b-purple">${e.pi}</span>
            ${e.ano === 2025 ? '<span class="badge b-yellow" style="margin-left:0.2rem;">2025 RPNP</span>' : ''}
          </td>
          <td class="wrap"><strong>${escHtml(e.credor)}</strong></td>
          <td class="mono small">${formatDoc(e.doc)}</td>
          <td class="num pos"><strong>${formatMoeda(totALiq)}</strong></td>
          <td class="num">${formatMoeda(totLiq)}</td>
          <td class="num muted">${formatMoeda(totP)}</td>
          <td class="num font-bold">${formatMoeda(totGeral)}</td>
          <td class="center">${statusBadge}</td>
          <td class="center" onclick="event.stopPropagation()">
            <button class="btn btn-xs btn-primary" onclick="abrirDetalheNE('${e.ne}')">Detalhes / Baixa</button>
          </td>
        </tr>
      `;
    }).join('');

    tableEl.innerHTML = `
      <thead>
        <tr>
          <th>NE</th>
          <th>Seção</th>
          <th>Plano Interno</th>
          <th>Fornecedor</th>
          <th>CNPJ / CPF</th>
          <th class="num">A Liquidar (Saldo)</th>
          <th class="num">Liq. a Pagar</th>
          <th class="num">Pago</th>
          <th class="num">Total NE</th>
          <th class="center">Status SAG</th>
          <th class="center">Ações</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml || '<tr><td colspan="11" class="center muted py-4">Nenhum empenho encontrado para os filtros selecionados.</td></tr>'}
      </tbody>
      <tfoot>
        <tr class="row-total">
          <td colspan="5">TOTAL (${filtrados.length} empenhos exibidos)</td>
          <td class="num">${formatMoeda(somaALiq)}</td>
          <td class="num">${formatMoeda(somaLiq)}</td>
          <td class="num">${formatMoeda(somaPago)}</td>
          <td class="num">${formatMoeda(somaALiq + somaLiq + somaPago)}</td>
          <td colspan="2"></td>
        </tr>
      </tfoot>
    `;

    const footerEl = document.getElementById('ne-table-footer');
    if (footerEl) {
      footerEl.innerText = `Exibindo ${filtrados.length} de ${state.empenhos.length} empenhos.`;
    }
  }

  // Tabela Envios e Prazos
  function renderTabelaEnvios() {
    const filter = document.getElementById('envio-filter')?.value || 'acao';
    const tableEl = document.getElementById('envio-table');
    if (!tableEl) return;

    let list = state.empenhos.map(e => {
      const aLiq = e.linhas.reduce((acc, l) => acc + Number(l.aLiquidar || 0), 0);
      const dias = e.dataEnvio ? getDiasDecorridos(e.dataEnvio) : null;
      const contato = state.contatos.find(c => c.doc && e.doc && c.doc.replace(/\D/g,'') === e.doc.replace(/\D/g,'')) || {};
      return { ...e, aLiq, dias, contato };
    });

    if (filter === 'acao') {
      list = list.filter(e => e.aLiq > 0 && (!e.dataEnvio || e.dias > state.config.prazoReenvioDias));
    } else if (filter === 'pendente') {
      list = list.filter(e => e.aLiq > 0 && !e.dataEnvio);
    } else if (filter === 'prazo') {
      list = list.filter(e => e.aLiq > 0 && e.dias !== null && e.dias <= state.config.prazoReenvioDias);
    } else if (filter === 'reenviar') {
      list = list.filter(e => e.aLiq > 0 && e.dias > state.config.prazoReenvioDias && e.dias <= state.config.prazoProcessoDias);
    } else if (filter === 'processo') {
      list = list.filter(e => e.aLiq > 0 && e.dias > state.config.prazoProcessoDias);
    } else if (filter === 'concluido') {
      list = list.filter(e => e.aLiq <= 0);
    }

    tableEl.innerHTML = `
      <thead>
        <tr>
          <th>NE</th>
          <th>Fornecedor</th>
          <th>E-mail do Fornecedor</th>
          <th>Telefone</th>
          <th>Data Envio</th>
          <th class="center">Dias Corridos</th>
          <th class="num">Saldo Pendente</th>
          <th class="center">Situação / Prazo</th>
          <th class="center">Ação Automática</th>
        </tr>
      </thead>
      <tbody>
        ${list.map(e => {
          let badge = '';
          let btnAcao = '';

          if (e.aLiq <= 0) {
            badge = `<span class="badge b-green">Totalmente Entregue</span>`;
          } else if (!e.dataEnvio) {
            badge = `<span class="badge b-gray">Não Enviado</span>`;
            btnAcao = `<button class="btn btn-xs btn-primary" onclick="dispararEnvioNE('${e.ne}')">📤 Enviar 1º E-mail</button>`;
          } else if (e.dias > state.config.prazoProcessoDias) {
            badge = `<span class="badge b-red">⚖️ Proc. Adm (${e.dias} dias)</span>`;
            btnAcao = `<button class="btn btn-xs btn-danger" onclick="abrirProcessoAdm('${e.ne}')">⚖️ Gerar Processo</button>`;
          } else if (e.dias > state.config.prazoReenvioDias) {
            badge = `<span class="badge b-yellow">🔁 Reenviar (${e.dias} dias)</span>`;
            btnAcao = `<button class="btn btn-xs btn-gold" onclick="dispararReenvioNE('${e.ne}')">🔁 Notificar Atraso</button>`;
          } else {
            const faltam = state.config.prazoEntregaDias - e.dias;
            badge = `<span class="badge b-blue">⏳ ${faltam > 0 ? `Faltam ${faltam}d` : 'No limite'}</span>`;
            btnAcao = `<button class="btn btn-xs" onclick="dispararEnvioNE('${e.ne}', true)">Reenviar Cópia</button>`;
          }

          const emailTxt = e.contato.email || '<span class="muted small">Não cadastrado</span>';
          const telTxt = e.contato.telefone || '<span class="muted small">-</span>';

          return `
            <tr>
              <td class="ne-code">${e.ne}</td>
              <td class="wrap"><strong>${e.credor}</strong></td>
              <td>${emailTxt}</td>
              <td>${telTxt}</td>
              <td>${formatData(e.dataEnvio)}</td>
              <td class="center font-bold">${e.dias !== null ? `${e.dias}d` : '-'}</td>
              <td class="num pos"><strong>${formatMoeda(e.aLiq)}</strong></td>
              <td class="center">${badge}</td>
              <td class="center">${btnAcao}</td>
            </tr>
          `;
        }).join('')}
      </tbody>
    `;
  }

  // Ações de Envio e Notificação
  window.dispararEnvioNE = function (ne, forcar = false) {
    const emp = state.empenhos.find(x => x.ne === ne);
    if (!emp) return;
    const contato = state.contatos.find(c => c.doc && emp.doc && c.doc.replace(/\D/g,'') === emp.doc.replace(/\D/g,'')) || {};

    const modalHtml = `
      <div class="field mb-3">
        <label>Empresa Destinatária</label>
        <div class="font-bold">${emp.credor} (CNPJ: ${formatDoc(emp.doc)})</div>
      </div>
      <div class="field mb-3">
        <label>E-mail da Empresa (pode alterar antes de enviar)</label>
        <input type="email" id="env-email" class="input-control w-full" value="${contato.email || ''}" placeholder="email@empresa.com.br" />
      </div>
      <div class="field mb-3">
        <label>Assunto</label>
        <input type="text" id="env-assunto" class="input-control w-full" value="[SISAPROV/RANCHO] Envio da Nota de Empenho ${emp.ne} - Prazo de Entrega: 30 dias" />
      </div>
      <div class="field mb-3">
        <label>Mensagem</label>
        <textarea id="env-corpo" class="input-control" rows="8">Prezados Senhores da ${emp.credor},

Vimos por meio deste encaminhar formalmente a NOTA DE EMPENHO ${emp.ne}, emitida pelo ${state.config.omNome} (Setor de Aprovisionamento / Rancho).

Informamos que o PRAZO MÁXIMO PARA A ENTREGA TOTAL DOS GÊNEROS/MATERIAIS É DE 30 (TRINTA) DIAS CORRIDOS, a contar da data deste recebimento.

Pedimos a gentileza de acusar recebimento desta mensagem e informar a data prevista para entrega no Depósito da OM.

Atenciosamente,
${state.config.omSub}
${state.config.omNome} - ${state.config.omCidade}</textarea>
      </div>
    `;

    const footerHtml = `
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="confirmarEnvioNE('${emp.ne}')">✉️ Confirmar Envio e Iniciar Contagem (30 dias)</button>
    `;

    openModal(`📤 Enviar Empenho ${emp.ne} para a Empresa`, modalHtml, footerHtml);
  };

  window.confirmarEnvioNE = function (ne) {
    const emp = state.empenhos.find(x => x.ne === ne);
    if (!emp) return;
    const email = document.getElementById('env-email')?.value.trim();
    if (!email) {
      alert('Por favor, informe o e-mail da empresa.');
      return;
    }

    // Salva o contato se não tinha
    let c = state.contatos.find(x => x.doc && emp.doc && x.doc.replace(/\D/g,'') === emp.doc.replace(/\D/g,''));
    if (!c) {
      c = { nome: emp.credor, doc: emp.doc, email: email, telefone: '' };
      state.contatos.push(c);
    } else {
      c.email = email;
    }

    const hoje = new Date().toISOString().split('T')[0];
    emp.dataEnvio = hoje;
    emp.historicoEnvios = emp.historicoEnvios || [];
    emp.historicoEnvios.push({ data: hoje, tipo: 'Primeiro Envio', email: email });

    saveState();
    closeModal();
    showToast(`Empenho ${ne} marcado como enviado para ${email}! Contagem de 30 dias iniciada.`, 'ok');
    renderTabelaEnvios();
  };

  window.dispararReenvioNE = function (ne) {
    const emp = state.empenhos.find(x => x.ne === ne);
    if (!emp) return;
    const contato = state.contatos.find(c => c.doc && emp.doc && c.doc.replace(/\D/g,'') === emp.doc.replace(/\D/g,'')) || {};
    const dias = getDiasDecorridos(emp.dataEnvio);

    const modalHtml = `
      <div class="callout warn">
        ⚠️ O empenho foi enviado há <strong>${dias} dias</strong> e ainda possui saldo pendente de entrega.
      </div>
      <div class="field mb-3">
        <label>E-mail da Empresa</label>
        <input type="email" id="reenv-email" class="input-control w-full" value="${contato.email || ''}" />
      </div>
      <div class="field mb-3">
        <label>Mensagem de Cobrança / Notificação</label>
        <textarea id="reenv-corpo" class="input-control" rows="8">Prezados Senhores da ${emp.credor},

REITERAÇÃO DE COBRANÇA — PRAZO EXPIRADO

Constatamos que a NOTA DE EMPENHO ${emp.ne}, enviada em ${formatData(emp.dataEnvio)} (há ${dias} dias), ainda possui entregas pendentes junto ao Rancho do ${state.config.omNome}.

Solicitamos a entrega imediata ou justificativa fundamentada no prazo improrrogável de 48 (quarenta e oito) horas, sob pena de abertura de Processo Administrativo para aplicação das sanções legais previstas na Lei de Licitações.

Atenciosamente,
${state.config.omSub}</textarea>
      </div>
    `;

    const footerHtml = `
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-gold" onclick="confirmarReenvio('${emp.ne}')">🔁 Registrar Reenvio e Notificação</button>
    `;

    openModal(`🔁 Notificação de Atraso (> 30 dias) — NE ${emp.ne}`, modalHtml, footerHtml);
  };

  window.confirmarReenvio = function (ne) {
    const emp = state.empenhos.find(x => x.ne === ne);
    if (!emp) return;
    const hoje = new Date().toISOString().split('T')[0];
    emp.historicoEnvios = emp.historicoEnvios || [];
    emp.historicoEnvios.push({ data: hoje, tipo: 'Reenvio de Cobrança (30d)' });
    saveState();
    closeModal();
    showToast(`Reenvio de notificação registrado para o empenho ${ne}!`, 'ok');
    renderTabelaEnvios();
  };

  // Processo Administrativo (> 60 dias)
  window.abrirProcessoAdm = function (ne) {
    const emp = state.empenhos.find(x => x.ne === ne);
    if (!emp) return;
    const dias = getDiasDecorridos(emp.dataEnvio);
    const totALiq = emp.linhas.reduce((acc, l) => acc + Number(l.aLiquidar || 0), 0);

    const docHtml = `
      <div class="print-doc" style="padding: 1.5rem; border: 1px solid #ccc; background:#fff; font-family:'Times New Roman', Times, serif; line-height:1.6;">
        <div style="text-align:center; font-weight:bold; margin-bottom: 1.5rem;">
          MINISTÉRIO DA DEFESA<br>
          EXÉRCITO BRASILEIRO<br>
          ${state.config.omNome}<br>
          SETOR DE APROVISIONAMENTO / RANCHO
        </div>

        <div style="text-align:right; margin-bottom: 1.5rem;">
          ${state.config.omCidade}, ${new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}.
        </div>

        <div style="margin-bottom: 1.5rem;">
          <strong>DESPACHO DE ABERTURA DE PROCESSO ADMINISTRATIVO SANCIONATÓRIO</strong><br>
          <strong>Referência:</strong> Descumprimento de prazo de entrega — Nota de Empenho nº ${emp.ne}<br>
          <strong>Interessada:</strong> ${emp.credor} (CNPJ: ${formatDoc(emp.doc)})
        </div>

        <p style="text-indent: 2rem; text-align: justify;">
          1. Versam os autos sobre o descumprimento injustificado do prazo de entrega referente à <strong>Nota de Empenho nº ${emp.ne}</strong>, no valor pendente de <strong>${formatMoeda(totALiq)}</strong>, formalmente transmitida à empresa em <strong>${formatData(emp.dataEnvio)}</strong>, decorridos mais de <strong>${dias} dias</strong> sem a regularização do fornecimento.
        </p>

        <p style="text-indent: 2rem; text-align: justify;">
          2. Esgotadas as tentativas de notificação e transcorrido o prazo regulamentar sem a entrega dos gêneros/materiais indispensáveis à manutenção da alimentação do efetivo militar desta Organização Militar, <strong>DETERMINO A ABERTURA DE PROCESSO ADMINISTRATIVO</strong>, assegurados o contraditório e a ampla defesa, para apuração dos fatos e aplicação das penalidades contratuais cabíveis.
        </p>

        <p style="text-indent: 2rem; text-align: justify;">
          3. Autue-se e notifique-se a empresa para apresentar defesa prévia no prazo legal.
        </p>

        <div style="margin-top: 3.5rem; text-align:center;">
          ___________________________________________________<br>
          <strong>Encarregado do Setor de Aprovisionamento</strong><br>
          ${state.config.omNome}
        </div>
      </div>
    `;

    const footerHtml = `
      <button class="btn" onclick="closeModal()">Fechar</button>
      <button class="btn btn-primary" onclick="window.print()">🖨 Imprimir Despacho em PDF</button>
      <button class="btn btn-danger" onclick="marcarProcAdmIniciado('${emp.ne}')">⚖️ Confirmar Registro de Processo</button>
    `;

    openModal(`⚖️ Notificação / Abertura de Processo Administrativo (${dias} dias)`, docHtml, footerHtml);
  };

  window.marcarProcAdmIniciado = function (ne) {
    const emp = state.empenhos.find(x => x.ne === ne);
    if (!emp) return;
    emp.emProcessoAdm = true;
    emp.dataProcessoAdm = new Date().toISOString().split('T')[0];
    saveState();
    closeModal();
    showToast(`Empenho ${ne} marcado como 'Em Processo Administrativo'!`, 'ok');
    renderTabelaEnvios();
  };

  // Detalhes da NE e Baixas
  window.abrirDetalheNE = function (ne) {
    const emp = state.empenhos.find(x => x.ne === ne);
    if (!emp) return;
    const rot = state.roteiros.find(r => r.ne === ne);
    const totALiq = emp.linhas.reduce((acc, l) => acc + Number(l.aLiquidar || 0), 0);
    const totLiq = emp.linhas.reduce((acc, l) => acc + Number(l.liquidadoAPagar || 0), 0);
    const totP = emp.linhas.reduce((acc, l) => acc + Number(l.pago || 0), 0);

    let itensHtml = '';
    if (rot && rot.itens && rot.itens.length > 0) {
      itensHtml = `
        <h4 class="section-title">Itens do Empenho (Roteiro de Entregas)</h4>
        <div class="table-scroll mb-4">
          <table class="data-table">
            <thead>
              <tr>
                <th>Item / Descrição</th>
                <th class="num">Qtd Total</th>
                <th class="num">Valor Unit.</th>
                <th class="num">Total Item</th>
                <th class="num">Saldo a Entregar</th>
              </tr>
            </thead>
            <tbody>
              ${rot.itens.map(it => `
                <tr>
                  <td class="desc"><strong>${it.desc}</strong></td>
                  <td class="num">${formatNumero(it.qtdTotal)}</td>
                  <td class="num">${formatMoeda(it.vlUnit)}</td>
                  <td class="num">${formatMoeda(it.qtdTotal * it.vlUnit)}</td>
                  <td class="num ${Number(it.saldoQtd) > 0 ? 'pos font-bold' : 'muted'}">${formatNumero(it.saldoQtd)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    }

    const modalHtml = `
      <div class="info-grid">
        <div class="info-cell">
          <div class="k">Número do Empenho</div>
          <div class="v mono">${emp.ne}</div>
        </div>
        <div class="info-cell">
          <div class="k">Plano Interno (PI)</div>
          <div class="v">${emp.pi}</div>
        </div>
        <div class="info-cell">
          <div class="k">Fornecedor</div>
          <div class="v">${emp.credor}</div>
        </div>
        <div class="info-cell">
          <div class="k">CNPJ / CPF</div>
          <div class="v mono">${formatDoc(emp.doc)}</div>
        </div>
        <div class="info-cell">
          <div class="k">Saldo a Liquidar</div>
          <div class="v pos font-bold">${formatMoeda(totALiq)}</div>
        </div>
        <div class="info-cell">
          <div class="k">Liquidado a Pagar</div>
          <div class="v">${formatMoeda(totLiq)}</div>
        </div>
        <div class="info-cell">
          <div class="k">Total Pago</div>
          <div class="v muted">${formatMoeda(totP)}</div>
        </div>
        <div class="info-cell">
          <div class="k">Envio / Prazo</div>
          <div class="v">${emp.dataEnvio ? `${formatData(emp.dataEnvio)} (${getDiasDecorridos(emp.dataEnvio)} dias)` : 'Não enviado'}</div>
        </div>
      </div>

      ${itensHtml}

      <div class="card mb-3">
        <div class="card-header">
          <div class="card-title">📦 Registrar Nova Baixa / Entrega nesta NE</div>
        </div>
        <div class="card-body">
          <div class="form-grid">
            <div class="field">
              <label>Data da Entrega</label>
              <input type="date" id="baixa-data" class="input-control" value="${new Date().toISOString().split('T')[0]}" />
            </div>
            <div class="field">
              <label>Número da Nota Fiscal (NF)</label>
              <input type="text" id="baixa-nf" class="input-control" placeholder="Ex: 12345" />
            </div>
            <div class="field">
              <label>Valor da Nota Fiscal (R$)</label>
              <input type="number" id="baixa-valor" step="0.01" class="input-control" placeholder="0.00" />
            </div>
            <div class="field">
              <label>Status Inicial</label>
              <select id="baixa-status" class="select-control">
                <option value="Entregue">📦 Entregue (Aguardando Liquidação)</option>
                <option value="Liquidada">✅ Liquidada</option>
              </select>
            </div>
          </div>
          <div style="margin-top: 1rem; text-align: right;">
            <button class="btn btn-primary" onclick="salvarBaixaManual('${emp.ne}')">💾 Salvar Entrega e Abater do Saldo</button>
          </div>
        </div>
      </div>
    `;

    openModal(`Detalhes do Empenho ${emp.ne}`, modalHtml);
  };

  window.salvarBaixaManual = function (ne) {
    const emp = state.empenhos.find(x => x.ne === ne);
    if (!emp) return;

    const data = document.getElementById('baixa-data')?.value;
    const nf = document.getElementById('baixa-nf')?.value.trim();
    const valor = parseFloat(document.getElementById('baixa-valor')?.value || '0');
    const status = document.getElementById('baixa-status')?.value || 'Entregue';

    if (!valor || valor <= 0) {
      alert('Informe um valor válido para a Nota Fiscal.');
      return;
    }

    // Abate o valor do saldo a liquidar
    if (emp.linhas && emp.linhas.length > 0) {
      let restante = valor;
      for (let l of emp.linhas) {
        if (l.aLiquidar >= restante) {
          l.aLiquidar -= restante;
          if (status === 'Liquidada') l.liquidadoAPagar += restante;
          restante = 0;
          break;
        } else {
          restante -= l.aLiquidar;
          if (status === 'Liquidada') l.liquidadoAPagar += l.aLiquidar;
          l.aLiquidar = 0;
        }
      }
    }

    // Registra no roteiro
    let rot = state.roteiros.find(r => r.ne === ne);
    if (!rot) {
      rot = { ne: ne, empresa: emp.credor, itens: [], entregas: [] };
      state.roteiros.push(rot);
    }
    rot.entregas = rot.entregas || [];
    rot.entregas.push({
      slot: rot.entregas.length + 1,
      data: data,
      nfNum: nf,
      nfValor: valor,
      status: status
    });

    saveState();
    closeModal();
    showToast(`Baixa de ${formatMoeda(valor)} na NF ${nf} realizada com sucesso!`, 'ok');
    renderTabelaEmpenhos();
  };

  // Cadastro de Novo Empenho
  function renderNovoEmpenho() {
    const formEl = document.getElementById('nova-ne-form');
    if (!formEl) return;

    formEl.innerHTML = `
      <div class="form-grid">
        <div class="field">
          <label>Número da NE (Ex: 2026NE000999)</label>
          <input type="text" id="novo-ne" class="input-control" placeholder="2026NE000999" />
        </div>
        <div class="field">
          <label>CNPJ / CPF do Credor</label>
          <div class="input-with-btn">
            <input type="text" id="novo-doc" class="input-control" placeholder="00.000.000/0000-00" />
            <button class="btn btn-sm" type="button" onclick="consultarCnpjNovo()">🔍 Buscar</button>
          </div>
        </div>
        <div class="field span-2">
          <label>Nome / Razão Social do Credor</label>
          <input type="text" id="novo-credor" class="input-control" placeholder="Razão social da empresa" />
        </div>
        <div class="field">
          <label>Plano Interno (PI)</label>
          <input type="text" id="novo-pi" class="input-control" value="E6SUPLJA1QR" />
        </div>
        <div class="field">
          <label>Valor do Empenho (R$)</label>
          <input type="number" step="0.01" id="novo-valor" class="input-control" placeholder="0.00" />
        </div>
        <div class="field">
          <label>Vincular à Nota de Crédito (NC)</label>
          <select id="novo-nc" class="select-control">
            <option value="">Nenhuma / Sem vínculo</option>
            ${state.notasCredito.map(nc => `<option value="${nc.nc}">${nc.nc} (Saldo: ${formatMoeda(nc.valor)})</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>Enviar E-mail Imediato à Empresa?</label>
          <select id="novo-autoenvio" class="select-control">
            <option value="sim">Sim (iniciar prazo de 30 dias)</option>
            <option value="nao">Não (enviar depois)</option>
          </select>
        </div>
      </div>
      <div style="margin-top: 1.2rem; text-align: right;">
        <button class="btn btn-primary" onclick="salvarNovoEmpenho()">💾 Cadastrar Empenho</button>
      </div>
    `;

    renderImportadorTG();
  }

  window.consultarCnpjNovo = function () {
    const doc = document.getElementById('novo-doc')?.value.replace(/\D/g, '');
    if (!doc || doc.length !== 14) {
      alert('Informe um CNPJ válido com 14 dígitos.');
      return;
    }
    showToast('Buscando dados na Receita Federal via BrasilAPI...', 'ok');
    fetch(`https://brasilapi.com.br/api/cnpj/v1/${doc}`)
      .then(res => res.json())
      .then(dados => {
        if (dados.razao_social) {
          document.getElementById('novo-credor').value = dados.razao_social;
          showToast(`Empresa localizada: ${dados.razao_social}`, 'ok');
          // Salva ou atualiza contato
          let c = state.contatos.find(x => x.doc && x.doc.replace(/\D/g,'') === doc);
          if (!c) {
            c = { nome: dados.razao_social, doc: doc, email: dados.email || '', telefone: dados.ddd_telefone_1 || '' };
            state.contatos.push(c);
          } else {
            if (dados.email) c.email = dados.email;
            if (dados.ddd_telefone_1) c.telefone = dados.ddd_telefone_1;
          }
          saveState();
        } else {
          alert('CNPJ não localizado na API pública.');
        }
      })
      .catch(err => {
        console.error(err);
        alert('Não foi possível consultar a API da Receita Federal no momento.');
      });
  };

  window.salvarNovoEmpenho = function () {
    const ne = document.getElementById('novo-ne')?.value.trim().toUpperCase();
    const doc = document.getElementById('novo-doc')?.value.replace(/\D/g, '');
    const credor = document.getElementById('novo-credor')?.value.trim();
    const pi = document.getElementById('novo-pi')?.value.trim();
    const valor = parseFloat(document.getElementById('novo-valor')?.value || '0');
    const autoenvio = document.getElementById('novo-autoenvio')?.value === 'sim';

    if (!ne || !credor || !valor) {
      alert('Preencha os campos obrigatórios: NE, Credor e Valor.');
      return;
    }

    if (state.empenhos.some(e => e.ne === ne)) {
      alert('Já existe um empenho cadastrado com este número!');
      return;
    }

    const hoje = new Date().toISOString().split('T')[0];
    const novoEmp = {
      ne: ne,
      ug: '160462',
      pi: pi,
      data: hoje,
      doc: doc,
      credor: credor,
      tipo: 'ANO',
      dataEnvio: autoenvio ? hoje : null,
      linhas: [{
        nd: '33903007',
        ndNome: 'GENEROS DE ALIMENTACAO',
        aLiquidar: valor,
        liquidadoAPagar: 0,
        pago: 0
      }]
    };

    state.empenhos.unshift(novoEmp);
    saveState();
    showToast(`Empenho ${ne} cadastrado com sucesso!`, 'ok');
    navigateTab('tab-empenhos');
  };

  // ===== IMPORTAÇÃO DO SAG / TESOURO GERENCIAL (colar da tela ou enviar arquivo) =====
  function numBR(v) {
    if (v === null || v === undefined || v === '') return 0;
    if (typeof v === 'number') return isNaN(v) ? 0 : v;
    let s = String(v).replace(/R\$/gi, '').replace(/\s/g, '');
    if (s === '' || s === '-') return 0;
    if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  }

  function docDigits(v) {
    const s = String(v || '').replace(/\D/g, '');
    if (!s) return '';
    return s.length <= 11 ? s.padStart(11, '0') : s.padStart(14, '0');
  }

  function ndStr(v) {
    const n = parseFloat(String(v || '').replace(',', '.'));
    return isNaN(n) ? String(v || '') : n.toFixed(0);
  }

  function dataISO(v) {
    const s = String(v || '').trim();
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (m) {
      const y = m[3].length === 2 ? '20' + m[3] : m[3];
      return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    }
    const n = parseFloat(s);
    if (!isNaN(n) && n > 30000 && n < 80000) {
      const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000);
      return d.toISOString().split('T')[0];
    }
    return '';
  }

  // Localiza as colunas pela posição da NE (não depende de a coluna DATA existir)
  function parseSAGRows(rows) {
    const out = [];
    let ignoradas = 0;
    rows.forEach(r => {
      const c = r.map(x => (x === null || x === undefined) ? '' : String(x).trim());
      const neIdx = c.findIndex(x => /^\d{4}\s*NE\s*\d+$/i.test(x));
      if (neIdx < 0) return; // cabeçalho, total ou linha vazia
      const m = c[neIdx].match(/^(\d{4})\s*NE\s*0*(\d+)$/i);
      const ne = m[1] + 'NE' + m[2].padStart(6, '0');
      let chaveIdx = -1;
      for (let k = neIdx + 1; k < c.length; k++) {
        if (/\d{4}NE\d{6}$/i.test(c[k]) && c[k].length >= 18) { chaveIdx = k; break; }
      }
      const base = chaveIdx >= 0 ? chaveIdx : neIdx;
      if (c.length <= base + 4) { ignoradas++; return; }
      out.push({
        ne: ne,
        ug: neIdx >= 4 ? c[0] : '160462',
        pi: neIdx >= 4 ? c[1] : '',
        nd: neIdx >= 4 ? ndStr(c[2]) : '',
        ndNome: neIdx >= 4 ? c[3] : '',
        data: chaveIdx > neIdx + 1 ? dataISO(c[neIdx + 1]) : '',
        doc: docDigits(c[base + 1]),
        credor: c[base + 2] || '',
        tipo: c[base + 3] || 'ANO',
        aLiquidar: numBR(c[base + 4]),
        liquidadoAPagar: numBR(c[base + 5]),
        pago: numBR(c[base + 7])
      });
    });
    return { linhas: out, ignoradas: ignoradas };
  }

  function textoParaLinhas(txt) {
    return String(txt || '').split(/\r?\n/).filter(l => l.trim() !== '').map(l => {
      return l.indexOf('\t') >= 0 ? l.split('\t') : l.split(/\s{2,}/);
    });
  }

  function acharLinhaNd(emp, l) {
    return emp.linhas.find(x => String(x.nd) === l.nd) ||
      (emp.linhas.length === 1 && !emp.linhas[0].nd ? emp.linhas[0] : null);
  }

  function planejarImportacaoSAG(linhas) {
    const porNE = {};
    linhas.forEach(l => { (porNE[l.ne] = porNE[l.ne] || []).push(l); });
    const novos = [], alterados = [];
    let iguais = 0;
    Object.keys(porNE).forEach(ne => {
      const ls = porNE[ne];
      const emp = state.empenhos.find(e => e.ne === ne);
      if (!emp) { novos.push({ ne: ne, credor: ls[0].credor, aLiq: ls.reduce((a, x) => a + x.aLiquidar, 0) }); return; }
      let mudou = false;
      ls.forEach(l => {
        const lin = acharLinhaNd(emp, l);
        if (!lin) { mudou = true; return; }
        if (Math.abs((lin.aLiquidar || 0) - l.aLiquidar) > 0.005 ||
            Math.abs((lin.liquidadoAPagar || 0) - l.liquidadoAPagar) > 0.005 ||
            Math.abs((lin.pago || 0) - l.pago) > 0.005) mudou = true;
      });
      if (mudou) alterados.push(ne); else iguais++;
    });
    const ausentes = state.empenhos
      .filter(e => !porNE[e.ne] && e.linhas.reduce((a, x) => a + Number(x.aLiquidar || 0), 0) > 0)
      .map(e => ({ ne: e.ne, credor: e.credor, aLiq: e.linhas.reduce((a, x) => a + Number(x.aLiquidar || 0), 0) }));
    return { novos, alterados, iguais, ausentes, totalLinhas: linhas.length };
  }

  window._importSAGPendente = null;

  function prepararImportacaoSAG(rows, origem) {
    const res = parseSAGRows(rows);
    if (res.linhas.length === 0) {
      alert('Não encontrei nenhum empenho nos dados. Confira se copiou a tabela inteira (com a coluna NE) e tente novamente.');
      return;
    }
    const plano = planejarImportacaoSAG(res.linhas);
    window._importSAGPendente = res.linhas;
    const totalALiq = res.linhas.reduce((a, x) => a + x.aLiquidar, 0);

    const listaNovos = plano.novos.length === 0 ? '<span class="muted small">Nenhum</span>' :
      `<div class="table-scroll" style="max-height:200px;"><table class="data-table"><tbody>${plano.novos.map(n =>
        `<tr><td class="ne-code">${n.ne}</td><td class="wrap">${n.credor}</td><td class="num">${formatMoeda(n.aLiq)}</td></tr>`).join('')}</tbody></table></div>`;
    const listaAus = plano.ausentes.length === 0 ? '<span class="muted small">Nenhum</span>' :
      `<div class="table-scroll" style="max-height:200px;"><table class="data-table"><tbody>${plano.ausentes.map(n =>
        `<tr><td class="ne-code">${n.ne}</td><td class="wrap">${n.credor}</td><td class="num">${formatMoeda(n.aLiq)}</td></tr>`).join('')}</tbody></table></div>`;

    const body = `
      <div class="info-grid">
        <div class="info-cell"><div class="k">Linhas lidas (${origem})</div><div class="v mono">${res.linhas.length}</div></div>
        <div class="info-cell"><div class="k">Total A LIQUIDAR no SAG</div><div class="v mono pos">${formatMoeda(totalALiq)}</div></div>
        <div class="info-cell"><div class="k">Empenhos novos</div><div class="v mono">${plano.novos.length}</div></div>
        <div class="info-cell"><div class="k">Com valores diferentes</div><div class="v mono">${plano.alterados.length}</div></div>
        <div class="info-cell"><div class="k">Sem alteração</div><div class="v mono">${plano.iguais}</div></div>
        <div class="info-cell"><div class="k">Linhas ignoradas</div><div class="v mono">${res.ignoradas}</div></div>
      </div>
      <div class="callout info">Os valores do SAG prevalecem sobre os do SISEMP. Datas de envio, e-mails, roteiros e notas fiscais lançadas <strong>não</strong> são apagados.</div>
      <h4 class="section-title">🆕 Empenhos novos que serão cadastrados</h4>
      ${listaNovos}
      <h4 class="section-title">⚠️ Empenhos com saldo no SISEMP que não aparecem nesta lista</h4>
      <div class="muted small" style="margin-bottom:.4rem;">Podem já ter sido pagos totalmente ou a tela copiada pode estar filtrada. Nada será alterado neles.</div>
      ${listaAus}
    `;
    const footer = `
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="confirmarImportacaoSAG()">✅ Confirmar importação</button>
    `;
    openModal('📥 Conferir importação do SAG', body, footer);
  }

  window.confirmarImportacaoSAG = function () {
    const linhas = window._importSAGPendente || [];
    let novos = 0, atualizados = 0;
    const tocados = {};
    linhas.forEach(l => {
      let emp = state.empenhos.find(e => e.ne === l.ne);
      if (!emp) {
        emp = {
          ne: l.ne, ug: l.ug || '160462', pi: l.pi, data: l.data || new Date().toISOString().split('T')[0],
          doc: l.doc, credor: l.credor, tipo: l.tipo, linhas: []
        };
        state.empenhos.push(emp);
        novos++;
        tocados[l.ne] = true;
      } else if (!tocados[l.ne]) {
        atualizados++;
        tocados[l.ne] = true;
      }
      if (!emp.pi && l.pi) emp.pi = l.pi;
      if (!emp.doc && l.doc) emp.doc = l.doc;
      if (!emp.credor && l.credor) emp.credor = l.credor;
      if (l.data && !emp.data) emp.data = l.data;
      let lin = acharLinhaNd(emp, l);
      if (!lin) {
        lin = { nd: l.nd, ndNome: l.ndNome, aLiquidar: 0, liquidadoAPagar: 0, pago: 0 };
        emp.linhas.push(lin);
      }
      if (!lin.nd) { lin.nd = l.nd; lin.ndNome = l.ndNome; }
      lin.aLiquidar = l.aLiquidar;
      lin.liquidadoAPagar = l.liquidadoAPagar;
      lin.pago = l.pago;
    });
    window._importSAGPendente = null;
    garantirContatosDosEmpenhos();
    saveState();
    closeModal();
    showToast(`Importação concluída: ${novos} novos e ${atualizados} atualizados.`, 'ok');
    carregarAbaItensEmpresa();
    navigateTab('tab-empenhos');
  };

  window.lerColadoSAG = function () {
    const txt = document.getElementById('sag-paste')?.value || '';
    if (!txt.trim()) { alert('Cole primeiro os dados copiados da tela do SAG.'); return; }
    prepararImportacaoSAG(textoParaLinhas(txt), 'texto colado');
  };

  function renderImportadorTG() {
    const el = document.getElementById('import-tg');
    if (!el) return;
    el.innerHTML = `
      <div class="callout info">
        <strong>Como atualizar pelo SAG (mais rápido):</strong> na tela do SAG, clique na tabela e aperte
        <code>Ctrl + A</code> e depois <code>Ctrl + C</code>. Volte aqui, clique na caixa abaixo, aperte <code>Ctrl + V</code> e clique em <strong>Ler dados colados</strong>.
        Antes de gravar, o sistema mostra o que vai mudar para você confirmar.
      </div>
      <div class="field" style="margin-bottom:.8rem;">
        <label>Dados copiados da tela do SAG</label>
        <textarea id="sag-paste" class="input-control" rows="6" placeholder="Cole aqui (Ctrl + V) a tabela copiada do SAG…"></textarea>
      </div>
      <div style="margin-bottom:1.2rem;">
        <button class="btn btn-primary" onclick="lerColadoSAG()">📋 Ler dados colados</button>
      </div>
      <div class="section-title">Ou envie um arquivo</div>
      <div class="dropzone" id="tg-dropzone" onclick="document.getElementById('tg-file').click()">
        <input type="file" id="tg-file" accept=".xlsx,.csv" hidden />
        <div class="dropzone-icon">📊</div>
        <div><strong>Clique para escolher a planilha</strong> (.xlsx ou .csv) exportada do SAG ou do Tesouro Gerencial</div>
      </div>
    `;

    const fileInput = document.getElementById('tg-file');
    if (fileInput) {
      fileInput.addEventListener('change', function (e) {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function (evt) {
          try {
            const data = new Uint8Array(evt.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
            const json = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });
            prepararImportacaoSAG(json, file.name);
          } catch (err) {
            console.error(err);
            alert('Erro ao processar arquivo: ' + err.message);
          }
          fileInput.value = '';
        };
        reader.readAsArrayBuffer(file);
      });
    }
  }

  // Exposto apenas para testes automáticos
  window.SISEMP_TEST = { parseSAGRows: parseSAGRows, textoParaLinhas: textoParaLinhas, planejarImportacaoSAG: planejarImportacaoSAG, numBR: numBR };

  // Fila de Liquidação e Baixas
  function renderEntregas() {
    const el = document.getElementById('receb-form');
    if (!el) return;

    el.innerHTML = `
      <div class="form-grid">
        <div class="field span-2">
          <label>Selecione o Empenho com Saldo</label>
          <select id="rec-ne" class="select-control w-full" onchange="carregarItensParaRecebimento(this.value)">
            <option value="">Selecione...</option>
            ${state.empenhos.filter(e => e.linhas.some(l => l.aLiquidar > 0)).map(e => `
              <option value="${e.ne}">${e.ne} - ${e.credor} (Saldo: ${formatMoeda(e.linhas.reduce((acc,l)=>acc+l.aLiquidar,0))})</option>
            `).join('')}
          </select>
        </div>
        <div class="field">
          <label>Data de Recebimento</label>
          <input type="date" id="rec-data" class="input-control" value="${new Date().toISOString().split('T')[0]}" />
        </div>
        <div class="field">
          <label>Número da NF</label>
          <input type="text" id="rec-nf" class="input-control" placeholder="12345" />
        </div>
        <div class="field span-2">
          <label>Valor Total da NF (R$)</label>
          <input type="number" step="0.01" id="rec-valor" class="input-control" placeholder="0.00" />
        </div>
      </div>
      <div style="margin-top: 1rem; text-align: right;">
        <button class="btn btn-primary" onclick="confirmarRecebimentoRapido()">📥 Registrar Recebimento</button>
      </div>
    `;

    renderFilaTable();
  }

  function renderFilaTable() {
    const filter = document.getElementById('fila-filter')?.value || 'Entregue';
    const tableEl = document.getElementById('fila-table');
    if (!tableEl) return;

    let entregas = [];
    state.roteiros.forEach(r => {
      if (r.entregas) {
        r.entregas.forEach(ent => {
          entregas.push({ ...ent, ne: r.ne, empresa: r.empresa });
        });
      }
    });

    if (filter) {
      entregas = entregas.filter(e => (e.status || 'Entregue').toLowerCase().includes(filter.toLowerCase()));
    }

    tableEl.innerHTML = `
      <thead>
        <tr>
          <th>NE</th>
          <th>Fornecedor</th>
          <th>Data Entrega</th>
          <th>Nº NF</th>
          <th class="num">Valor da NF</th>
          <th class="center">Status</th>
          <th class="center">Ação</th>
        </tr>
      </thead>
      <tbody>
        ${entregas.map(e => `
          <tr>
            <td class="ne-code">${e.ne}</td>
            <td class="wrap"><strong>${e.empresa}</strong></td>
            <td>${formatData(e.data)}</td>
            <td class="mono font-bold">${e.nfNum || '-'}</td>
            <td class="num font-bold">${formatMoeda(e.nfValor)}</td>
            <td class="center"><span class="badge ${e.status === 'Liquidada' ? 'b-blue' : (e.status === 'Pago' ? 'b-green' : 'b-yellow')}">${e.status || 'Entregue'}</span></td>
            <td class="center">
              ${e.status !== 'Liquidada' && e.status !== 'Pago' ? `
                <button class="btn btn-xs btn-primary" onclick="liquidarEntrega('${e.ne}', '${e.nfNum}')">✅ Liquidar</button>
              ` : `
                <span class="muted small">Concluído</span>
              `}
            </td>
          </tr>
        `).join('')}
      </tbody>
    `;
  }

  window.liquidarEntrega = function (ne, nfNum) {
    const rot = state.roteiros.find(r => r.ne === ne);
    if (!rot) return;
    const ent = rot.entregas.find(e => e.nfNum === nfNum);
    if (!ent) return;

    ent.status = 'Liquidada';
    saveState();
    showToast(`NF ${nfNum} do empenho ${ne} liquidada!`, 'ok');
    renderFilaTable();
  };

  // Fornecedores e Busca de Contatos
  // Fornecedores e Busca de Contatos
  // Fornecedores e Busca de Contatos
  function renderFornecedores() {
    try { if (window._modoItensAtual === 'quem') aplicarFiltrosItens(); } catch (e) { console.error(e); }
    const tableEl = document.getElementById('forn-table');
    if (!tableEl) return;

    const filtroTexto = (document.getElementById('forn-filter')?.value || '').trim();
    const palavras = semAcento(filtroTexto).split(' ').filter(Boolean);

    let lista = state.contatos || [];
    if (palavras.length) {
      lista = lista.filter(c => {
        const str = semAcento(`${c.nome} ${c.doc} ${c.email} ${c.telefone} ${c.responsavel} ${c.endereco}`);
        return palavras.every(p => str.includes(p));
      });
    }

    tableEl.innerHTML = `
      <thead>
        <tr>
          <th>Raz\u00E3o Social / Nome da Empresa</th>
          <th>CNPJ / CPF</th>
          <th>Telefone (Ligar / WhatsApp)</th>
          <th>E-mail</th>
          <th>Respons\u00E1vel</th>
          <th>Cidade / Endere\u00E7o</th>
          <th class="center">A\u00E7\u00F5es R\u00E1pidas</th>
        </tr>
      </thead>
      <tbody>
        ${lista.length === 0 ? '<tr><td colspan="7" class="center muted py-4">Nenhum fornecedor encontrado.</td></tr>' :
          lista.map((c, idx) => {
            const originalIdx = state.contatos.indexOf(c);
            const lk = linksTelefone(c.telefone);
            const tel = c.telefone
              ? `<strong>${escHtml(formatarTelefone(c.telefone))}</strong>
                 ${lk ? `<div style="margin-top:0.25rem;"><a class="btn btn-xs" href="${lk.tel}" title="Ligar">\u{1F4DE} Ligar</a> <a class="btn btn-xs btn-primary" href="${lk.wa}" target="_blank" rel="noopener" title="Abrir WhatsApp">\u{1F4AC} WhatsApp</a></div>` : ''}`
              : '<span class="badge b-red">Sem telefone</span>';
            const mail = c.email
              ? `<a href="mailto:${escHtml(c.email)}" class="font-bold">${escHtml(c.email)}</a>`
              : '<span class="muted small">\u2014</span>';

            return `
              <tr>
                <td class="wrap">
                  <strong>${escHtml(c.nome)}</strong>
                </td>
                <td class="mono">${formatDoc(c.doc)}</td>
                <td>${tel}</td>
                <td>${mail}</td>
                <td>${c.responsavel ? escHtml(c.responsavel) : '<span class="muted">\u2014</span>'}</td>
                <td class="small muted">${c.endereco ? escHtml(c.endereco) : '\u2014'}</td>
                <td class="center" style="white-space:nowrap;">
                  <button class="btn btn-xs btn-gold" onclick="selecionarEmpresaParaBaixa('${escHtml(c.nome).replace(/'/g, "\\'")}', '')" title="Ver Notas de Empenho e Itens deste fornecedor">
                    \u{1F3E2} Ver Empenhos &amp; Itens
                  </button>
                  <button class="btn btn-xs" onclick="editarContato(${originalIdx})" title="Editar cadastro de contato">\u270F\uFE0F Editar</button>
                  ${c.doc && c.doc.replace(/\D/g,'').length === 14 ? `
                    <button class="btn btn-xs" onclick="buscarCnpjContato(${originalIdx})" title="Buscar na Receita Federal">\u{1F310} RF</button>
                  ` : ''}
                </td>
              </tr>
            `;
          }).join('')}
      </tbody>
    `;
  }

  // Listener para busca instant\u00E2nea de fornecedores
  document.getElementById('forn-filter')?.addEventListener('input', () => { renderFornecedores(); });
  window.buscarCnpjContato = function (idx) {
    const c = state.contatos[idx];
    if (!c || !c.doc) return;
    const cnpj = c.doc.replace(/\D/g, '');
    showToast(`Consultando Receita Federal para ${c.nome}...`, 'ok');

    fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`)
      .then(res => res.json())
      .then(d => {
        if (d.email) c.email = d.email;
        if (d.ddd_telefone_1) c.telefone = d.ddd_telefone_1;
        saveState();
        renderFornecedores();
        showToast(`Contatos de ${c.nome} atualizados com sucesso!`, 'ok');
      })
      .catch(err => {
        console.error(err);
        alert('Falha ao consultar CNPJ via API pública.');
      });
  };

  window.editarContato = function (idx) {
    const c = state.contatos[idx];
    if (!c) return;
    const bodyHtml = `
      <div class="field mb-3">
        <label>Nome / Razão Social</label>
        <input type="text" id="edit-forn-nome" class="input-control w-full" value="${c.nome || ''}" />
      </div>
      <div class="field mb-3">
        <label>CNPJ / CPF</label>
        <input type="text" id="edit-forn-doc" class="input-control w-full" value="${c.doc || ''}" />
      </div>
      <div class="field mb-3">
        <label>E-mail</label>
        <input type="email" id="edit-forn-email" class="input-control w-full" value="${c.email || ''}" />
      </div>
      <div class="field mb-3">
        <label>Telefone</label>
        <input type="text" id="edit-forn-tel" class="input-control w-full" value="${c.telefone || ''}" />
      </div>
      <div class="field mb-3">
        <label>Responsável / Contato</label>
        <input type="text" id="edit-forn-resp" class="input-control w-full" value="${c.responsavel || ''}" />
      </div>
    `;

    const footerHtml = `
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="salvarEdicaoContato(${idx})">💾 Salvar</button>
    `;

    openModal(`Editar Fornecedor: ${c.nome}`, bodyHtml, footerHtml);
  };

  window.salvarEdicaoContato = function (idx) {
    const c = state.contatos[idx];
    if (!c) return;
    c.nome = document.getElementById('edit-forn-nome')?.value.trim();
    c.doc = document.getElementById('edit-forn-doc')?.value.trim();
    c.email = document.getElementById('edit-forn-email')?.value.trim();
    c.telefone = document.getElementById('edit-forn-tel')?.value.trim();
    c.responsavel = document.getElementById('edit-forn-resp')?.value.trim();
    saveState();
    closeModal();
    renderFornecedores();
    showToast('Dados do fornecedor atualizados!', 'ok');
  };

  // Notas de Crédito
  function renderNotasCredito() {
    const el = document.getElementById('nc-list');
    if (!el) return;
    el.innerHTML = state.notasCredito.map(nc => `
      <div class="group-card">
        <div class="group-head">
          <div>
            <div class="gh-title">💰 ${nc.nc} — ${nc.pi}</div>
            <div class="gh-sub">Valor do Recurso: <strong>${formatMoeda(nc.valor)}</strong></div>
          </div>
          <span class="badge b-purple">${nc.usos ? nc.usos.length : 0} empenhos gerados</span>
        </div>
        <div class="group-body">
          <table class="data-table">
            <thead>
              <tr>
                <th>Fornecedor</th>
                <th>Requisição</th>
                <th class="num">Valor Empenhado</th>
                <th>NE Vinculada</th>
              </tr>
            </thead>
            <tbody>
              ${(nc.usos || []).map(u => `
                <tr>
                  <td><strong>${u.fornecedor}</strong></td>
                  <td>${u.req}</td>
                  <td class="num">${formatMoeda(u.valor)}</td>
                  <td class="ne-code">${u.ne || '-'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `).join('');
  }

  // Pregão
  function renderPregao() {
    const el = document.getElementById('pregao-list');
    if (!el) return;
    el.innerHTML = state.pregao.map(p => `
      <div class="group-card">
        <div class="group-head">
          <div>
            <div class="gh-title">🏢 ${p.fornecedor}</div>
            <div class="gh-sub">CNPJ: ${formatDoc(p.doc)} • ${p.itens.length} itens licitados</div>
          </div>
        </div>
        <div class="group-body table-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Descrição do Item</th>
                <th>Und</th>
                <th class="num">Qtd Licitada</th>
                <th class="num">Saldo a Empenhar</th>
              </tr>
            </thead>
            <tbody>
              ${p.itens.map(it => `
                <tr>
                  <td class="mono font-bold">${it.item}</td>
                  <td class="desc"><strong>${it.desc}</strong></td>
                  <td>${it.und}</td>
                  <td class="num">${formatNumero(it.qtdLicitada)}</td>
                  <td class="num ${Number(it.saldo) > 0 ? 'pos font-bold' : 'muted'}">${formatNumero(it.saldo)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `).join('');
  }

  // Configurações
  function renderConfig() {
    const el = document.getElementById('config-form');
    if (!el) return;
    el.innerHTML = `
      <div class="form-grid">
        <div class="field">
          <label>Prazo de Entrega (Dias)</label>
          <input type="number" id="cfg-prazo-entrega" class="input-control" value="${state.config.prazoEntregaDias}" />
        </div>
        <div class="field">
          <label>Prazo para Reenvio / Cobrança (Dias)</label>
          <input type="number" id="cfg-prazo-reenvio" class="input-control" value="${state.config.prazoReenvioDias}" />
        </div>
        <div class="field">
          <label>Prazo para Abertura de Processo (Dias)</label>
          <input type="number" id="cfg-prazo-processo" class="input-control" value="${state.config.prazoProcessoDias}" />
        </div>
        <div class="field span-2">
          <label>Nome da Organização Militar (OM)</label>
          <input type="text" id="cfg-om-nome" class="input-control w-full" value="${state.config.omNome}" />
        </div>
        <div class="field span-2">
          <label>Cidade / UF</label>
          <input type="text" id="cfg-om-cidade" class="input-control w-full" value="${state.config.omCidade}" />
        </div>
      </div>
      <div style="margin-top: 1.5rem; text-align: right;">
        <button class="btn btn-primary" onclick="salvarConfiguracoes()">💾 Salvar Preferências</button>
      </div>
    `;
  }

  window.salvarConfiguracoes = function () {
    state.config.prazoEntregaDias = parseInt(document.getElementById('cfg-prazo-entrega')?.value) || 30;
    state.config.prazoReenvioDias = parseInt(document.getElementById('cfg-prazo-reenvio')?.value) || 30;
    state.config.prazoProcessoDias = parseInt(document.getElementById('cfg-prazo-processo')?.value) || 60;
    state.config.omNome = document.getElementById('cfg-om-nome')?.value.trim() || state.config.omNome;
    state.config.omCidade = document.getElementById('cfg-om-cidade')?.value.trim() || state.config.omCidade;

    saveState();
    showToast('Configurações salvas com sucesso!', 'ok');
  };

  // Filtros rápidos
  window.filtrarEnvios = function (tipo) {
    navigateTab('tab-envios');
    const sel = document.getElementById('envio-filter');
    if (sel) {
      sel.value = tipo;
      renderTabelaEnvios();
    }
  };

  window.filtrarEmpenhosPorCredor = function (credor) {
    navigateTab('tab-empenhos');
    const inp = document.getElementById('ne-filter-text');
    if (inp) {
      inp.value = credor;
      renderTabelaEmpenhos();
    }
  };

  // Busca Global
  function setupBuscaGlobal() {
    const input = document.getElementById('global-search');
    const results = document.getElementById('global-search-results');
    if (!input || !results) return;

    input.addEventListener('input', function () {
      const q = this.value.trim().toLowerCase();
      if (!q) {
        results.classList.remove('open');
        return;
      }

      let matches = [];
      state.empenhos.forEach(e => {
        if (`${e.ne} ${e.credor} ${e.doc}`.toLowerCase().includes(q)) {
          matches.push({ tipo: 'Empenho', title: `${e.ne} - ${e.credor}`, sub: `Saldo: ${formatMoeda(e.linhas.reduce((acc,l)=>acc+l.aLiquidar,0))}`, action: () => abrirDetalheNE(e.ne) });
        }
      });

      state.contatos.forEach(c => {
        if (`${c.nome} ${c.doc} ${c.email}`.toLowerCase().includes(q)) {
          matches.push({ tipo: 'Fornecedor', title: c.nome, sub: `CNPJ: ${formatDoc(c.doc)} • Tel: ${c.telefone || '-'}`, action: () => filtrarEmpenhosPorCredor(c.nome) });
        }
      });

      if (matches.length === 0) {
        results.innerHTML = `<div class="p-3 text-center muted small">Nenhum resultado encontrado.</div>`;
      } else {
        results.innerHTML = matches.slice(0, 8).map((m, i) => `
          <div class="gs-item" onclick="executarBusca(${i})">
            <div class="gs-title">${m.title}</div>
            <div class="gs-sub">${m.tipo} • ${m.sub}</div>
          </div>
        `).join('');
        window._gsMatches = matches;
      }
      results.classList.add('open');
    });

    window.executarBusca = function (i) {
      if (window._gsMatches && window._gsMatches[i]) {
        window._gsMatches[i].action();
        results.classList.remove('open');
        input.value = '';
      }
    };

    document.addEventListener('click', e => {
      if (!input.contains(e.target) && !results.contains(e.target)) {
        results.classList.remove('open');
      }
    });

    // Atalho "/"
    document.addEventListener('keydown', e => {
      if (e.key === '/' && document.activeElement !== input) {
        e.preventDefault();
        input.focus();
      }
    });
  }

  // Backup e Restauração
  function setupBackup() {
    const btn = document.getElementById('btn-backup');
    if (!btn) return;
    btn.onclick = function () {
      const modalHtml = `
        <div class="mb-3">
          <p class="small text-secondary mb-2">Exporte todos os lançamentos, empenhos, baixas e contatos para um arquivo JSON ou restaure um backup prévio.</p>
          <button class="btn btn-primary w-full mb-3" onclick="exportarBackupJSON()">⬇ Baixar Backup Completo (.json)</button>
        </div>
        <hr class="mb-3" />
        <div class="field">
          <label>Restaurar Backup a partir de arquivo</label>
          <input type="file" id="backup-file" accept=".json" class="input-control" />
        </div>
      `;
      openModal('💾 Backup e Segurança dos Dados', modalHtml);

      document.getElementById('backup-file')?.addEventListener('change', function (e) {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function (evt) {
          try {
            state = JSON.parse(evt.target.result);
            saveState();
            closeModal();
            showToast('Backup restaurado com sucesso!', 'ok');
            navigateTab('tab-painel');
          } catch (err) {
            alert('Arquivo de backup inválido: ' + err.message);
          }
        };
        reader.readAsText(file);
      });
    };

    window.exportarBackupJSON = function () {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `backup_sisemp_${new Date().toISOString().split('T')[0]}.json`;
      a.click();
    };
  }

  // Exportar CSV
  function setupExportCsv() {
    const btn = document.getElementById('btn-export-csv');
    if (!btn) return;
    btn.onclick = function () {
      let csv = 'NE;PI;Credor;CNPJ;A_Liquidar;Liquidado_A_Pagar;Pago;Data_Envio;Dias_Envio;Status\n';
      state.empenhos.forEach(e => {
        const aLiq = e.linhas.reduce((acc,l)=>acc+l.aLiquidar,0);
        const liq = e.linhas.reduce((acc,l)=>acc+l.liquidadoAPagar,0);
        const pago = e.linhas.reduce((acc,l)=>acc+l.pago,0);
        const dias = e.dataEnvio ? getDiasDecorridos(e.dataEnvio) : '';
        csv += `${e.ne};${e.pi};"${e.credor}";${e.doc};${aLiq};${liq};${pago};${e.dataEnvio || ''};${dias};\n`;
      });

      const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `empenhos_rancho_${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
    };
  }

  // Listeners Gerais
  function setupEvents() {
    document.querySelectorAll('.nav-tab').forEach(b => {
      b.addEventListener('click', () => navigateTab(b.dataset.tab));
    });

    document.getElementById('modal-close')?.addEventListener('click', closeModal);
    document.getElementById('modal-backdrop')?.addEventListener('click', e => {
      if (e.target.id === 'modal-backdrop') closeModal();
    });

    document.getElementById('ne-filter-text')?.addEventListener('input', renderTabelaEmpenhos);
    document.getElementById('ne-filter-sit')?.addEventListener('change', renderTabelaEmpenhos);
    document.getElementById('ne-filter-pi')?.addEventListener('change', renderTabelaEmpenhos);
    document.getElementById('envio-filter')?.addEventListener('change', renderTabelaEnvios);
    document.getElementById('btn-buscar-todos')?.addEventListener('click', buscarContatosFaltantes);

    setupBuscaGlobal();
    setupBackup();
    setupExportCsv();
  }

  // Inicialização Robusta
  function boot() {
    try {
      initState();
      if (garantirContatosDosEmpenhos() > 0) saveState();
      setupEvents();
      updateKPIs();
      updateBadges();
      carregarAbaItensEmpresa();
      renderTabelaEmpenhos();
      renderEntregas();
      renderTabelaEnvios();
      renderNovoEmpenho();
      renderNotasCredito();
      renderFornecedores();
      renderConfig();
    } catch (e) {
      console.error('Erro no boot da aplicação:', e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();


  // ===== CATÃLOGO DE ITENS HOMOLOGADOS DO PREGÃƒO (322 ITENS) =====
  window.renderCatalogoPregao = function (filtroTexto = '', filtroEmpresa = '') {
    const container = document.getElementById('conteudo-itens-empresa');
    if (!container) return;

    const itens = state.itensPregao || [];
    if (!itens.length) {
      container.innerHTML = '<div class="card p-4 center muted">Nenhum item do pregÃ£o carregado.</div>';
      return;
    }

    // Agrupa por fornecedor
    const grupos = {};
    itens.forEach(it => {
      const forn = it.fornecedor || 'OUTROS';
      if (filtroEmpresa && !semAcento(forn).includes(semAcento(filtroEmpresa)) && forn !== filtroEmpresa) return;
      if (filtroTexto) {
        const str = `${it.item} ${it.descricao} ${it.unidade} ${forn}`.toLowerCase();
        if (!str.includes(filtroTexto.toLowerCase())) return;
      }
      if (!grupos[forn]) grupos[forn] = { forn: forn, cnpj: it.cnpj, itens: [] };
      grupos[forn].itens.push(it);
    });

    const chaves = Object.keys(grupos).sort((a,b) => a.localeCompare(b));
    if (!chaves.length) {
      container.innerHTML = '<div class="card p-4 center muted">Nenhum item do pregÃ£o corresponde aos filtros.</div>';
      return;
    }

    let totalGeralItens = 0;
    let valorTotalHomologado = 0;

    let html = `
      <div style="background:#fef9e7; border:1px solid #d4af37; border-radius:8px; padding:0.85rem 1.2rem; margin-bottom:1rem; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:0.5rem;">
        <div>
          <strong style="color:#854d0e;">\u{1F4D1} CatÃ¡logo Consolidado de Itens Homologados do PregÃ£o (QR)</strong>
          <div class="muted small">RelaÃ§Ã£o completa de itens com preÃ§os unitÃ¡rios registrados, especificaÃ§Ãµes tÃ©cnicas e fornecedores responsÃ¡veis</div>
        </div>
        <div style="display:flex; gap:0.5rem;">
          <a href="https://docs.google.com/spreadsheets/d/1gV1NiMO4JoDTVMVLN8EfqbY7V6GE0Y4ZTJ_Nb01EaJs/edit" target="_blank" rel="noopener" class="btn btn-sm btn-gold">\u{1F4CA} Abrir Planilha do PregÃ£o</a>
        </div>
      </div>
    `;

    chaves.forEach(k => {
      const g = grupos[k];
      const contato = acharContatoDoEmpenho({ doc: g.cnpj, credor: g.forn }, g.forn);
      const tel = contato && contato.telefone ? contato.telefone : '';
      const email = contato && contato.email ? contato.email : '';
      const resp = contato && contato.responsavel ? contato.responsavel : '';

      let subtotalForn = g.itens.reduce((acc, it) => acc + (it.valorTotal || (it.quantidade * it.valorUnitario) || 0), 0);
      valorTotalHomologado += subtotalForn;
      totalGeralItens += g.itens.length;

      html += `
        <div class="card mb-4" style="border-left:4px solid var(--army-gold);">
          <div class="card-header" style="background:#fdfdfd;">
            <div>
              <div class="card-title" style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;">
                \u{1F3E2} <strong>${escHtml(g.forn)}</strong>
                <span class="mono small muted">${formatDoc(g.cnpj)}</span>
                <span class="badge b-gold font-bold">${g.itens.length} itens homologados</span>
              </div>
              <div class="card-subtitle" style="display:flex; gap:1rem; margin-top:0.3rem; flex-wrap:wrap;">
                ${resp ? `<span>\u{1F464} Contato: <strong>${escHtml(resp)}</strong></span>` : ''}
                ${tel ? `<span>\u{1F4DE} Tel: <a href="tel:${soDigitos(tel)}">${escHtml(tel)}</a></span>` : ''}
                ${email ? `<span>\u2709\uFE0F E-mail: <a href="mailto:${escHtml(email)}">${escHtml(email)}</a></span>` : ''}
                <span>\u{1F4B0} Total Homologado: <strong>${formatMoeda(subtotalForn)}</strong></span>
              </div>
            </div>
            <div class="toolbar no-print">
              <button class="btn btn-xs btn-outline font-bold" onclick="selecionarEmpresaParaBaixa('${escHtml(g.forn)}', '')">\u{1F4E6} Ver Empenhos da Empresa</button>
            </div>
          </div>
          <div class="card-body p-0">
            <div class="table-scroll">
              <table class="data-table">
                <thead>
                  <tr>
                    <th style="width:70px;">Item</th>
                    <th>DescriÃ§Ã£o do Item</th>
                    <th>Unidade</th>
                    <th class="num">Qtd Homologada</th>
                    <th class="num">Valor Unit. (R$)</th>
                    <th class="num">Valor Total (R$)</th>
                    <th class="center">AÃ§Ã£o</th>
                  </tr>
                </thead>
                <tbody>
                  ${g.itens.map(it => `
                    <tr>
                      <td class="center font-bold ne-code">#${it.item}</td>
                      <td class="wrap"><strong>${escHtml(it.descricao)}</strong></td>
                      <td><span class="badge b-gray">${escHtml(it.unidade)}</span></td>
                      <td class="num font-bold">${formatNumero(it.quantidade)}</td>
                      <td class="num">${formatMoeda(it.valorUnitario)}</td>
                      <td class="num font-bold pos">${formatMoeda(it.valorTotal || (it.quantidade * it.valorUnitario))}</td>
                      <td class="center">
                        <button class="btn btn-xs btn-primary font-bold" onclick="selecionarEmpresaParaBaixa('${escHtml(g.forn)}', '')" title="Abrir ficha da empresa para conferir saldo de empenhos">
                          \u{1F4E6} Empenhos
                        </button>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      `;
    });

    container.innerHTML = html;
  };

  // InicializaÃ§Ã£o com auto-sincronizaÃ§Ã£o do SAG
  setTimeout(() => {
    if (typeof sincronizarPlanilhaSAG === 'function') {
      sincronizarPlanilhaSAG(false);
    }
  }, 2500);
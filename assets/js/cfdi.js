/* ════════════════════════════════════════════════════════════
   CONTRIX — Lectura y validación de CFDI (3.3 / 4.0, Pagos 1.0/2.0,
   Nómina 1.2) en el navegador. No envía el XML a ningún servidor.
   ════════════════════════════════════════════════════════════ */
(function () {
  const RFC_RE = /^[A-ZÑ&]{3,4}\d{6}[A-Z\d]{3}$/;
  const n = (v) => { const x = parseFloat(v); return isNaN(x) ? 0 : x; };
  const r2 = (v) => Math.round(v * 100) / 100;

  function hijo(el, nombre) {
    if (!el) return null;
    for (const c of el.children) if (c.localName === nombre) return c;
    return null;
  }
  function hijos(el, nombre) {
    if (!el) return [];
    return [...el.children].filter((c) => c.localName === nombre);
  }
  function todos(doc, nombre) { return [...doc.getElementsByTagNameNS('*', nombre)]; }
  const at = (el, a) => (el ? el.getAttribute(a) : null);

  function leer(xmlTexto) {
    const doc = new DOMParser().parseFromString(xmlTexto.replace(/^﻿/, ''), 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('El archivo no es un XML válido');
    const comp = doc.documentElement;
    if (!comp || comp.localName !== 'Comprobante') throw new Error('El XML no es un CFDI (no tiene nodo Comprobante)');

    const version = at(comp, 'Version') || at(comp, 'version');
    const emisor = hijo(comp, 'Emisor');
    const receptor = hijo(comp, 'Receptor');
    const timbre = todos(doc, 'TimbreFiscalDigital')[0] || null;
    const impComp = hijo(comp, 'Impuestos');

    // Impuestos a nivel comprobante
    let ivaTras = 0, ivaRet = 0, isrRet = 0, iepsTras = 0;
    const trasladosComp = hijos(hijo(impComp, 'Traslados'), 'Traslado');
    const retencionesComp = hijos(hijo(impComp, 'Retenciones'), 'Retencion');
    trasladosComp.forEach((t) => {
      if (at(t, 'Impuesto') === '002') ivaTras += n(at(t, 'Importe'));
      if (at(t, 'Impuesto') === '003') iepsTras += n(at(t, 'Importe'));
    });
    retencionesComp.forEach((t) => {
      if (at(t, 'Impuesto') === '002') ivaRet += n(at(t, 'Importe'));
      if (at(t, 'Impuesto') === '001') isrRet += n(at(t, 'Importe'));
    });

    // Conceptos
    const conceptos = hijos(hijo(comp, 'Conceptos'), 'Concepto').map((c, i) => {
      const imp = hijo(c, 'Impuestos');
      const tras = hijos(hijo(imp, 'Traslados'), 'Traslado').map((t) => ({
        base: n(at(t, 'Base')), impuesto: at(t, 'Impuesto'), tipoFactor: at(t, 'TipoFactor'),
        tasa: at(t, 'TasaOCuota'), importe: n(at(t, 'Importe'))
      }));
      return {
        orden: i, clave_prod_serv: at(c, 'ClaveProdServ'), no_identificacion: at(c, 'NoIdentificacion'),
        cantidad: n(at(c, 'Cantidad')), clave_unidad: at(c, 'ClaveUnidad'), unidad: at(c, 'Unidad'),
        descripcion: at(c, 'Descripcion') || '(sin descripción)', valor_unitario: n(at(c, 'ValorUnitario')),
        importe: n(at(c, 'Importe')), descuento: n(at(c, 'Descuento')), objeto_imp: at(c, 'ObjetoImp'),
        traslados: tras
      };
    });

    const tipo = at(comp, 'TipoDeComprobante');

    // Complemento de pagos (1.0 y 2.0)
    const pagos = [];
    let totalesPago = null;
    if (tipo === 'P') {
      todos(doc, 'Pago').forEach((p) => {
        if (p.parentNode && p.parentNode.localName !== 'Pagos') return;
        hijos(p, 'DoctoRelacionado').forEach((d) => {
          pagos.push({
            fecha_pago: at(p, 'FechaPago'), forma_pago: at(p, 'FormaDePagoP'), moneda: at(d, 'MonedaDR') || at(p, 'MonedaP'),
            uuid_relacionado: (at(d, 'IdDocumento') || '').toUpperCase(), num_parcialidad: parseInt(at(d, 'NumParcialidad') || '0', 10) || null,
            imp_saldo_ant: n(at(d, 'ImpSaldoAnt')), imp_pagado: n(at(d, 'ImpPagado')), imp_saldo_insoluto: n(at(d, 'ImpSaldoInsoluto'))
          });
        });
      });
      const tot = todos(doc, 'Totales')[0];
      if (tot) {
        totalesPago = {
          iva: n(at(tot, 'TotalTrasladosImpuestoIVA16')) + n(at(tot, 'TotalTrasladosImpuestoIVA8')),
          ivaRet: n(at(tot, 'TotalRetencionesIVA')), isrRet: n(at(tot, 'TotalRetencionesISR')),
          monto: n(at(tot, 'MontoTotalPagos'))
        };
        ivaTras = totalesPago.iva; ivaRet = totalesPago.ivaRet; isrRet = totalesPago.isrRet;
      }
    }

    // Nómina 1.2: ISR retenido
    if (tipo === 'N') {
      const ded = todos(doc, 'Deducciones')[0];
      if (ded) isrRet = n(at(ded, 'TotalImpuestosRetenidos'));
    }

    const sello = at(comp, 'Sello') || '';
    const datos = {
      version,
      uuid_sat: timbre ? (at(timbre, 'UUID') || '').toUpperCase() : null,
      serie: at(comp, 'Serie'), folio: at(comp, 'Folio'), tipo,
      fecha_emision: at(comp, 'Fecha'), fecha_timbrado: at(timbre, 'FechaTimbrado'),
      emisor_rfc: (at(emisor, 'Rfc') || at(emisor, 'rfc') || '').toUpperCase(), emisor_nombre: at(emisor, 'Nombre'),
      emisor_regimen: at(emisor, 'RegimenFiscal'),
      receptor_rfc: (at(receptor, 'Rfc') || at(receptor, 'rfc') || '').toUpperCase(), receptor_nombre: at(receptor, 'Nombre'),
      receptor_uso_cfdi: at(receptor, 'UsoCFDI'), receptor_cp: at(receptor, 'DomicilioFiscalReceptor'),
      receptor_regimen: at(receptor, 'RegimenFiscalReceptor'),
      subtotal: n(at(comp, 'SubTotal')), descuento: n(at(comp, 'Descuento')),
      iva_trasladado: r2(ivaTras), iva_retenido: r2(ivaRet), isr_retenido: r2(isrRet), ieps_trasladado: r2(iepsTras),
      total_traslados: n(at(impComp, 'TotalImpuestosTrasladados')), total_retenciones: n(at(impComp, 'TotalImpuestosRetenidos')),
      total: n(at(comp, 'Total')), moneda: at(comp, 'Moneda') || 'MXN', tipo_cambio: n(at(comp, 'TipoCambio')) || 1,
      forma_pago: at(comp, 'FormaPago'), metodo_pago: at(comp, 'MetodoPago'), condiciones_pago: at(comp, 'CondicionesDePago'),
      lugar_expedicion: at(comp, 'LugarExpedicion'), exportacion: at(comp, 'Exportacion'),
      pac: at(timbre, 'RfcProvCertif'), sello8: sello.slice(-8),
      conceptos, pagos, totalesPago, traslados_comp: trasladosComp.length
    };
    return datos;
  }

  /* Reglas de validación. Cada resultado: { nivel: 'ok'|'aviso'|'error', msg } */
  function validar(d, opciones = {}) {
    const res = [];
    const add = (nivel, msg) => res.push({ nivel, msg });

    if (!d.uuid_sat) add('error', 'No tiene Timbre Fiscal Digital (UUID): no es un CFDI timbrado.');
    else add('ok', 'Timbrado con UUID ' + d.uuid_sat.slice(0, 8) + '…');

    if (d.version === '4.0') add('ok', 'Versión 4.0');
    else if (d.version === '3.3' && d.fecha_emision && d.fecha_emision >= '2023-04-01') add('aviso', 'Versión 3.3 emitida después del 1 de abril de 2023, cuando dejó de poder emitirse.');
    else add('aviso', 'Versión ' + (d.version || 'desconocida'));

    if (!RFC_RE.test(d.emisor_rfc)) add('error', 'RFC del emisor con formato inválido: ' + (d.emisor_rfc || 'vacío'));
    if (!RFC_RE.test(d.receptor_rfc)) add('error', 'RFC del receptor con formato inválido: ' + (d.receptor_rfc || 'vacío'));
    if (RFC_RE.test(d.emisor_rfc) && RFC_RE.test(d.receptor_rfc)) add('ok', 'RFC de emisor y receptor con formato válido');

    if (d.version === '4.0') {
      if (!d.receptor_cp) add('error', 'Falta el domicilio fiscal (CP) del receptor, obligatorio en CFDI 4.0.');
      if (!d.receptor_regimen) add('error', 'Falta el régimen fiscal del receptor, obligatorio en CFDI 4.0.');
      if (!d.exportacion) add('error', 'Falta el atributo Exportación, obligatorio en CFDI 4.0.');
    }

    if (d.tipo !== 'P' && d.tipo !== 'T') {
      const sumaConc = d.conceptos.reduce((s, c) => s + c.importe, 0);
      const tol = 0.01 * Math.max(1, d.conceptos.length);
      if (Math.abs(sumaConc - d.subtotal) > tol) add('error', `La suma de conceptos (${fmt(sumaConc)}) no coincide con el SubTotal (${fmt(d.subtotal)}).`);
      else add('ok', 'La suma de conceptos cuadra con el SubTotal');

      const esperado = d.subtotal - d.descuento + d.total_traslados - d.total_retenciones;
      if (Math.abs(esperado - d.total) > 0.02 && d.tipo !== 'N') add('error', `El Total (${fmt(d.total)}) no coincide con SubTotal − Descuento + Traslados − Retenciones (${fmt(esperado)}).`);
      else if (d.tipo !== 'N') add('ok', 'El Total cuadra con subtotal, descuentos e impuestos');

      let ivaMal = 0;
      d.conceptos.forEach((c) => c.traslados.forEach((t) => {
        if (t.impuesto === '002' && t.tipoFactor === 'Tasa' && t.tasa) {
          const calc = t.base * parseFloat(t.tasa);
          if (Math.abs(calc - t.importe) > 0.05) ivaMal++;
        }
      }));
      if (ivaMal) add('error', `${ivaMal} traslado(s) de IVA no corresponden a Base × Tasa.`);
      else if (d.iva_trasladado > 0) add('ok', 'El IVA de cada concepto corresponde a Base × Tasa');
    }

    if (d.tipo === 'I' || d.tipo === 'E') {
      if (d.metodo_pago === 'PPD' && d.forma_pago && d.forma_pago !== '99') add('error', 'Con método PPD la forma de pago debe ser 99 (Por definir).');
      if (d.metodo_pago === 'PUE' && d.forma_pago === '99') add('error', 'Con método PUE la forma de pago no puede ser 99 (Por definir).');
      if (d.metodo_pago === 'PPD') add('aviso', 'Factura PPD: requiere complemento de pago cuando se liquide.');
    }

    if (d.moneda && d.moneda !== 'MXN' && d.moneda !== 'XXX' && (!d.tipo_cambio || d.tipo_cambio === 1)) {
      add('aviso', `Moneda ${d.moneda} sin tipo de cambio distinto de 1.`);
    }

    if (opciones.rfcEmpresa) {
      const r = opciones.rfcEmpresa.toUpperCase();
      if (d.emisor_rfc !== r && d.receptor_rfc !== r) add('error', `Este CFDI no es de tu empresa (${r}): no eres emisor ni receptor.`);
    }
    if (opciones.efos && opciones.efos.length) {
      opciones.efos.forEach((e) => add(e.situacion === 'definitivo' || e.situacion === 'presunto' ? 'error' : 'aviso',
        `${e.rfc} aparece en la lista 69-B del SAT como "${SAT.situacion69B[e.situacion] || e.situacion}".`));
    }
    return res;
  }

  function fmt(v) { return (v || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' }); }

  // URL oficial de verificación del SAT (misma que lleva el código QR del CFDI)
  function urlVerificacion(c) {
    const tt = Number(c.total || 0).toString();
    return 'https://verificacfdi.facturaelectronica.sat.gob.mx/default.aspx?id=' + encodeURIComponent(c.uuid_sat) +
      '&re=' + encodeURIComponent(c.emisor_rfc) + '&rr=' + encodeURIComponent(c.receptor_rfc) +
      '&tt=' + tt + (c.sello8 ? '&fe=' + encodeURIComponent(c.sello8) : '');
  }

  /* Genera XML CFDI 4.0 SIN sello ni timbre (borrador para revisión) */
  function generarXML40(f) {
    const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const a = (o) => Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => `${k}="${esc(v)}"`).join(' ');
    const d2 = (v) => (Math.round(v * 100) / 100).toFixed(2);
    const d6 = (v) => Number(v).toFixed(6);
    let conc = '';
    const agrup = {};
    f.conceptos.forEach((c) => {
      let imp = '';
      if (c.objeto_imp === '02') {
        const base = c.importe - (c.descuento || 0);
        if (c.iva === 'exento') {
          imp = `<cfdi:Impuestos><cfdi:Traslados><cfdi:Traslado ${a({ Base: d2(base), Impuesto: '002', TipoFactor: 'Exento' })}/></cfdi:Traslados></cfdi:Impuestos>`;
          const k = 'Exento'; agrup[k] = agrup[k] || { base: 0, importe: 0, tipo: 'Exento' }; agrup[k].base += base;
        } else {
          const tasa = parseFloat(c.iva);
          const importe = base * tasa;
          imp = `<cfdi:Impuestos><cfdi:Traslados><cfdi:Traslado ${a({ Base: d2(base), Impuesto: '002', TipoFactor: 'Tasa', TasaOCuota: d6(tasa), Importe: d2(importe) })}/></cfdi:Traslados></cfdi:Impuestos>`;
          const k = d6(tasa); agrup[k] = agrup[k] || { base: 0, importe: 0, tipo: 'Tasa', tasa }; agrup[k].base += base; agrup[k].importe += importe;
        }
      }
      conc += `<cfdi:Concepto ${a({ ClaveProdServ: c.clave_prod_serv, NoIdentificacion: c.no_identificacion, Cantidad: c.cantidad, ClaveUnidad: c.clave_unidad, Unidad: SAT.claveUnidad[c.clave_unidad], Descripcion: c.descripcion, ValorUnitario: d2(c.valor_unitario), Importe: d2(c.importe), Descuento: c.descuento ? d2(c.descuento) : null, ObjetoImp: c.objeto_imp })}>${imp}</cfdi:Concepto>`;
    });
    let impComp = '';
    const tras = Object.values(agrup);
    if (tras.length) {
      const totalTras = tras.reduce((s, t) => s + t.importe, 0);
      const hayTasa = tras.some((t) => t.tipo === 'Tasa');
      impComp = `<cfdi:Impuestos ${a({ TotalImpuestosTrasladados: hayTasa ? d2(totalTras) : null })}><cfdi:Traslados>` +
        tras.map((t) => t.tipo === 'Exento'
          ? `<cfdi:Traslado ${a({ Base: d2(t.base), Impuesto: '002', TipoFactor: 'Exento' })}/>`
          : `<cfdi:Traslado ${a({ Base: d2(t.base), Impuesto: '002', TipoFactor: 'Tasa', TasaOCuota: d6(t.tasa), Importe: d2(t.importe) })}/>`).join('') +
        `</cfdi:Traslados></cfdi:Impuestos>`;
    }
    return `<?xml version="1.0" encoding="UTF-8"?>\n<!-- BORRADOR generado por Contrix: sin sello ni timbre. No es un CFDI válido hasta timbrarse con un PAC autorizado. -->\n` +
      `<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.sat.gob.mx/cfd/4 http://www.sat.gob.mx/sitio_internet/cfd/4/cfdv40.xsd" ` +
      a({ Version: '4.0', Serie: f.serie, Folio: f.folio, Fecha: f.fecha, FormaPago: f.forma_pago, SubTotal: d2(f.subtotal), Descuento: f.descuento ? d2(f.descuento) : null, Moneda: 'MXN', Total: d2(f.total), TipoDeComprobante: 'I', Exportacion: '01', MetodoPago: f.metodo_pago, LugarExpedicion: f.lugar_expedicion }) + '>' +
      `<cfdi:Emisor ${a({ Rfc: f.emisor_rfc, Nombre: f.emisor_nombre, RegimenFiscal: f.emisor_regimen })}/>` +
      `<cfdi:Receptor ${a({ Rfc: f.receptor_rfc, Nombre: f.receptor_nombre, DomicilioFiscalReceptor: f.receptor_cp, RegimenFiscalReceptor: f.receptor_regimen, UsoCFDI: f.receptor_uso_cfdi })}/>` +
      `<cfdi:Conceptos>${conc}</cfdi:Conceptos>${impComp}</cfdi:Comprobante>`;
  }

  window.CFDI = { leer, validar, urlVerificacion, generarXML40, RFC_RE };
})();

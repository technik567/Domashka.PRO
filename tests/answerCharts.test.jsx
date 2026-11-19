import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { compileMathExpression } from '../src/standalone/mathExpression';
import { parseChart, renderChartHtml, GRAPHIC_ANSWER_PROMPT } from '../src/standalone/answerCharts';
import MarkdownMath, { renderMarkdownWithMath } from '../src/components/MarkdownMath';
const chart = (overrides = {}) => JSON.stringify({ type:'function', expression:'x^2', domain:[-5,5], ...overrides });

describe('bounded math interpreter', () => {
  it.each([['-x²',3,-9],['2x+1',3,7],['2^-2',0,.25],['2^3^2',0,512],['2**3',0,8],['sin(pi/2)',0,1],['f(x) = sqrt(x)',9,3],['2(x+1)',3,8],['1e-3*x',1000,1],['ln(e)',0,1]])('evaluates %s without JavaScript', (expr,x,y) => expect(compileMathExpression(expr)(x)).toBeCloseTo(y));
  it.each(['alert(1)','x.constructor','this','1; fetch(x)','(()=>2)()','[1][0]','1 2','x=2','sin x','__proto__',''.padStart(401,'x'),'('.repeat(40)+'x'+')'.repeat(40)])('rejects unsafe/ambiguous/bounded expression %s', (expr) => expect(() => compileMathExpression(expr)).toThrow());
  it('keeps undefined real values and poles out of a sampled path', () => {
    expect(Number.isNaN(compileMathExpression('sqrt(-1)')(0))).toBe(true);
    expect(parseChart(chart({ expression:'1/x',domain:[-1,1] })).series[0].points[128][1]).toBe(null);
    const doc = new DOMParser().parseFromString(renderChartHtml(chart({ expression:'1/x',domain:[-1,1], yRange:[-10,10] })),'text/html');
    const path = doc.querySelector('path[stroke="#2563eb"]').getAttribute('d'); expect((path.match(/M/g)||[]).length).toBeGreaterThanOrEqual(2);
  });
});
describe('chart schema and safe renderer', () => {
  it('never truncates a long but valid formula to the label limit', () => {
    const expression = ' '.repeat(140)+'x^2'; const parsed = parseChart(chart({expression}));
    expect(parsed.expression).toBe(expression); expect(parsed.series[0].points[128][1]).toBe(0);
    expect(() => parseChart(chart({expression:' '.repeat(400)+'x'}))).toThrow();
  });
  it.each([{type:'pie'}, {domain:[2,1]}, {domain:[1,1]}, {yRange:[0,0]}, {expression:'sqrt(-1)'}, {expression:'1e13'}, {type:'bar',labels:['A'],values:[]}, {type:'line',series:[{points:[[0,'1']]}]}])('rejects malformed charts %j', (overrides) => expect(() => parseChart(chart(overrides))).toThrow());
  it('preserves data order and caps rows/series', () => {
    const points = [[2,4],[0,1],[1,2]]; expect(parseChart(JSON.stringify({type:'line',series:[{points}]})).series[0].points).toEqual(points);
    expect(() => parseChart(JSON.stringify({type:'line',series:[{points:Array(161).fill([1,2])}]}))).toThrow();
  });
  it('renders line, scatter, bars including negative values and accessible data', () => {
    for (const spec of [{type:'line',series:[{points:[[0,1],[1,2]]}]},{type:'scatter',series:[{points:[[0,1],[1,2]]}]},{type:'bar',labels:['A','B'],values:[-1,3]}]) {
      const html=renderChartHtml(JSON.stringify(spec)); expect(html).toContain('<svg'); expect(html).toContain('<table>'); expect(html).not.toMatch(/NaN|Infinity/);
    }
  });
  it('escapes title, labels and name without executable SVG or image loading', () => {
    const spec=JSON.stringify({type:'bar',title:'"><img src=x onerror=alert(1)>',labels:['<script>alert(1)</script>'],values:[2]});
    const host=document.createElement('div'); host.innerHTML=renderMarkdownWithMath('```domashka-chart\n'+spec+'\n```\n\n<img src="https://bad.example/pixel">\n\n![x](https://bad.example/pixel)');
    expect(host.querySelector('svg')).not.toBeNull(); expect(host.querySelector('img,script,foreignObject,use,iframe')).toBeNull(); expect(host.querySelector('svg').getAttribute('onload')).toBeNull();
  });
  it('bounds graph count and scrolls regular Markdown tables without breaking math', () => {
    render(<MarkdownMath content={('| A | B |\n|---|---|\n| 1 | 2 |\n\n$\\frac{1}{2}$\n\n')+Array(5).fill('```chart\n'+chart()+'\n```').join('\n\n')} />);
    expect(document.querySelectorAll('.ai-chart')).toHaveLength(4); expect(screen.getByRole('region',{name:'Таблица ответа'})).toBeTruthy(); expect(document.querySelector('.katex')).toBeTruthy();
  });
  it('downloads only the sanitized locally rendered SVG', () => {
    const create=vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:test'); const click=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(() => {});
    render(<MarkdownMath content={'```chart\n'+chart()+'\n```'} />); fireEvent.click(screen.getByRole('button',{name:'Скачать график SVG'}));
    expect(create).toHaveBeenCalledWith(expect.any(Blob)); expect(click).toHaveBeenCalledOnce();
  });
  it('sends a real JSON example, not backslash-escaped pseudocode, to the model', () => {
    expect(GRAPHIC_ANSWER_PROMPT).toContain('\n'); expect(GRAPHIC_ANSWER_PROMPT).toContain('{"type":"function"'); expect(GRAPHIC_ANSWER_PROMPT).not.toContain('\\"');
  });
});

/* Autoevaluación y avance en un archivo: el contenido de cada práctica y cómo se guarda e importa. */
import { describe, expect, it } from 'vitest';
import { AUTOEVAL } from './autoeval';
import { PRACTICES } from './index';
import { answerQuiz, exportProgress, importProgress, markChallenge, markDone, parseProgress, type Progress } from './motor';

describe('contenido de la autoevaluación', () => {
  it('cada práctica tiene 2 o 3 preguntas y un desafío', () => {
    for (const pr of PRACTICES) {
      const ae = AUTOEVAL[pr.id];
      expect(ae, pr.id).toBeTruthy();
      expect(ae.preguntas.length, pr.id).toBeGreaterThanOrEqual(2);
      expect(ae.preguntas.length, pr.id).toBeLessThanOrEqual(3);
      for (const q of ae.preguntas) {
        expect(q.opciones[q.correcta], q.enunciado).toBeTruthy();
        expect(new Set(q.opciones).size, q.enunciado).toBe(q.opciones.length);
        expect(q.porque.length).toBeGreaterThan(20);
      }
      expect(ae.desafio.enunciado && ae.desafio.pista && ae.desafio.solucion, pr.id).toBeTruthy();
    }
    expect(Object.keys(AUTOEVAL).sort()).toEqual(PRACTICES.map(p => p.id).sort());
  });
});

const [A, B] = PRACTICES;

describe('autoevaluación en el progreso', () => {
  it('cuenta la primera respuesta y el desafío se marca y desmarca', () => {
    let p: Progress = answerQuiz({}, A, 0, 2, false, 10);
    p = answerQuiz(p, A, 0, 1, true, 11);
    expect(p[A.id].quiz).toEqual({ 0: { pick: 2, ok: false, at: 10 } });
    p = markChallenge(p, A, true, 20);
    expect(p[A.id].desafio).toBe(20);
    expect(markChallenge(p, A, false)[A.id].desafio).toBeUndefined();
  });
  it('lo guardado viejo (sin quiz) se sigue leyendo y lo raro se descarta', () => {
    expect(parseProgress({ x: { done: {}, vars: {}, startedAt: 1, quiz: [1], desafio: 'si' } })).toEqual({ x: { done: {}, vars: {}, startedAt: 1 } });
    expect(parseProgress([1, 2])).toEqual({});
  });
});

describe('exportar e importar el avance', () => {
  it('ida y vuelta: lo exportado se importa igual (aunque venga con BOM)', () => {
    const p = markChallenge(answerQuiz(markDone({}, A, A.steps[0].id, 'run', { dn: '3' }, 5), A, 1, 0, true, 6), A, true, 7);
    const file = exportProgress(p, Date.UTC(2026, 9, 27));
    expect(JSON.parse(file)).toMatchObject({ tipo: 'bigdata-sandbox/practicas', version: 1, exportado: '2026-10-27T00:00:00.000Z' });
    expect(importProgress('﻿' + file, {})).toEqual({ progress: p, practices: 1 });
  });
  it('de cada práctica queda la más avanzada, y las respuestas se suman', () => {
    const mine = answerQuiz(markDone(markDone({}, A, A.steps[0].id, 'run', {}, 1), A, A.steps[1].id, 'run', {}, 2), A, 0, 0, true, 3);
    const theirs = answerQuiz(markDone(markDone({}, A, A.steps[0].id, 'manual', {}, 9), B, B.steps[0].id, 'run', {}, 9), A, 1, 1, false, 9);
    const { progress, practices } = importProgress(exportProgress(theirs), mine);
    expect(practices).toBe(2);
    expect(Object.keys(progress[A.id].done)).toHaveLength(2); // la mía tenía más pasos
    expect(progress[A.id].quiz).toEqual({ 0: mine[A.id].quiz![0], 1: theirs[A.id].quiz![1] });
    expect(progress[B.id]).toEqual(theirs[B.id]);
  });
  it('un archivo que no es un avance avisa y no toca nada', () => {
    expect(() => importProgress('hola', {})).toThrow(/no es JSON/);
    expect(() => importProgress('{"a":1}', {})).toThrow(/no es un avance/);
  });
});

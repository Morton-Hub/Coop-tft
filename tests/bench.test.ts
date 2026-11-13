import { describe, expect, it } from 'vitest';
import { benchCounts, isAccepted, readBench, recognisable } from '../src/screen/bench';
import { iconSignature, locateBenchSlots, type PixelFrame } from '../src/screen/icons';

/** Image unie, puis rectangles de couleur posés dessus. */
function canvas(width: number, height: number): PixelFrame & { fill(x: number, y: number, w: number, h: number, rgb: number[]): void } {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const frame = {
    width,
    height,
    data,
    fill(x: number, y: number, w: number, h: number, rgb: number[]) {
      for (let yy = Math.max(0, Math.round(y)); yy < Math.min(height, Math.round(y + h)); yy++)
        for (let xx = Math.max(0, Math.round(x)); xx < Math.min(width, Math.round(x + w)); xx++)
          data.set([...rgb, 255], (yy * width + xx) * 4);
    },
  };
  frame.fill(0, 0, width, height, [90, 120, 90]); // fond du plateau
  return frame;
}

/** Icône synthétique : deux couleurs en diagonale, pour qu'un décalage se voie. */
function drawIcon(f: ReturnType<typeof canvas>, x: number, y: number, size: number, a: number[], b: number[]) {
  f.fill(x, y, size, size, a);
  f.fill(x + size / 2, y + size / 2, size / 2, size / 2, b);
}

describe('banc d’objets', () => {
  const items = {
    sword: { name: 'Épée', icon: 'u' },
    tear: { name: 'Larme', icon: 'u' },
    shojin: { name: 'Lance de Shojin', icon: 'u', from: ['tear', 'sword'], current: true },
    oldemblem: { name: 'Emblème d’un ancien set', icon: 'u', from: ['tear', 'sword'] }, // pas du set en cours
    radiant: { name: 'Objet radiant', icon: 'u' }, // ni composant ni fabricable : ignoré
    noicon: { name: 'Sans icône', from: ['tear', 'tear'], current: true },
  };

  it('ne retient que les composants et les objets fabricables qui ont une icône', () => {
    expect(recognisable(items).sort()).toEqual(['shojin', 'sword', 'tear']);
  });

  it('exige une ressemblance nette et un avantage sur le deuxième candidat', () => {
    expect(isAccepted(0.03, 0.2)).toBe(true);
    expect(isAccepted(0.09, 0.1)).toBe(false); // trop proche du deuxième
    expect(isAccepted(0.15, 0.9)).toBe(false); // trop loin
  });

  it('reconnaît les icônes posées aux emplacements du banc et ignore les cases vides', () => {
    const colours: Record<string, [number[], number[]]> = {
      sword: [[200, 40, 40], [250, 220, 60]],
      tear: [[40, 80, 220], [200, 240, 255]],
      shojin: [[150, 30, 180], [30, 200, 180]],
    };
    const ref = (id: string) => {
      const f = canvas(64, 64);
      drawIcon(f, 0, 0, 64, ...colours[id]);
      return { id, signature: iconSignature(f, { x: 0, y: 0, w: 64, h: 64 }) };
    };
    const library = ['sword', 'tear', 'shojin'].map(ref);

    // Bande telle qu'envoyée par la capture : zone de jeu entière en hauteur, réduite de moitié.
    const strip = canvas(108, 771);
    const slots = locateBenchSlots(strip.width, strip.height, 0, strip.height);
    expect(slots.length).toBeGreaterThanOrEqual(5);
    drawIcon(strip, slots[0].x, slots[0].y, slots[0].w, ...colours.tear);
    drawIcon(strip, slots[1].x + 1, slots[1].y - 1, slots[1].w, ...colours.sword); // cadrage légèrement décalé
    drawIcon(strip, slots[2].x, slots[2].y, slots[2].w, ...colours.tear);

    const reads = readBench(strip, library);
    expect(reads.slice(0, 3).map((r) => [r.id, r.accepted])).toEqual([
      ['tear', true],
      ['sword', true],
      ['tear', true],
    ]);
    expect(reads.slice(3).every((r) => !r.accepted)).toBe(true);
    expect(benchCounts(reads)).toEqual({ tear: 2, sword: 1 });
    expect(readBench(strip, [])).toEqual([]);
  });
});

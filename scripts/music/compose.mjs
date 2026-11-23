// Original song + SFX library for the engine (PLAN ADR-8), written as FamiStudio text files.
// Dev-time only: `npm run music:export` turns them into ca65 data with the FamiStudio CLI.
// Every note here is ours (NES BLUM FACTORY, 2026). Nothing is transcribed from another work.
//
// Pattern notation, one token per step: `C5` starts a note, `-` holds it, `.` is silence.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const outDir = path.resolve(import.meta.dirname, '..', '..', 'engine', 'audio', 'src');

const INSTRUMENTS = `	Instrument Name="Lead"
		Envelope Type="Volume" Length="8" Values="12,11,10,9,9,8,8,7"
		Envelope Type="DutyCycle" Length="1" Values="2"
	Instrument Name="Soft"
		Envelope Type="Volume" Length="6" Values="7,7,6,6,5,4"
		Envelope Type="DutyCycle" Length="1" Values="1"
	Instrument Name="Pluck"
		Envelope Type="Volume" Length="6" Values="9,7,5,4,3,2"
		Envelope Type="DutyCycle" Length="1" Values="0"
	Instrument Name="Bass"
		Envelope Type="Volume" Length="1" Values="15"
	Instrument Name="Kick"
		Envelope Type="Volume" Length="5" Values="13,9,5,2,0"
	Instrument Name="Hat"
		Envelope Type="Volume" Length="3" Values="6,3,0"
	Instrument Name="Snare"
		Envelope Type="Volume" Length="7" Values="12,9,7,5,3,1,0"
`;

function steps(str) {
  return str.trim().split(/\s+/);
}

/** One pattern: tokens -> Note lines. `noteLen` frames per step. */
function patternNotes(tokens, noteLen, instrument) {
  const lines = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === '-' || t === '.') continue;
    let len = 1;
    while (i + len < tokens.length && tokens[i + len] === '-') len++;
    const [value, inst] = t.includes(':') ? t.split(':') : [t, instrument];
    lines.push(`\t\t\t\tNote Time="${i * noteLen}" Value="${value}" Duration="${len * noteLen}" Instrument="${inst}"`);
  }
  return lines;
}

/**
 * song: { name, noteLen, patternLen, order: [patternIndex...], loop, channels: { Square1: {inst, patterns: [str]}, ... } }
 */
function songText(song) {
  const out = [];
  out.push(
    `\tSong Name="${song.name}" Length="${song.order.length}" LoopPoint="${song.loop ?? 0}" PatternLength="${song.patternLen}" BeatLength="4" NoteLength="${song.noteLen}" Groove="${song.noteLen}" GroovePaddingMode="Middle"`,
  );
  for (const type of ['Square1', 'Square2', 'Triangle', 'Noise', 'DPCM']) {
    out.push(`\t\tChannel Type="${type}"`);
    const ch = song.channels[type];
    if (!ch) continue;
    ch.patterns.forEach((p, i) => {
      const tokens = steps(p);
      if (tokens.length !== song.patternLen) throw new Error(`${song.name}/${type}/${i}: ${tokens.length} steps, want ${song.patternLen}`);
      out.push(`\t\t\tPattern Name="${type}-${i}"`);
      out.push(...patternNotes(tokens, song.noteLen, ch.inst));
    });
    const order = ch.order ?? song.order;
    order.forEach((pi, t) => {
      if (pi !== null && pi !== undefined) out.push(`\t\t\tPatternInstance Time="${t}" Pattern="${type}-${pi}"`);
    });
  }
  return out.join('\n');
}

function project(name, songs) {
  return [`Project Version="4.5.3" TempoMode="FamiStudio" Name="${name}" Author="NES BLUM FACTORY"`, INSTRUMENTS.trimEnd(), ...songs.map(songText)].join('\n') + '\n';
}

// --- Song 0: "Bourgeon" (title). Gentle, 3/4 feel written in 12 steps per bar. ---
const title = {
  name: 'title',
  noteLen: 10,
  patternLen: 12,
  order: [0, 1, 2, 3],
  channels: {
    Square1: {
      inst: 'Lead',
      patterns: [
        'E5 - - G5 - - A5 - - G5 - -',
        'E5 - - D5 - - C5 - - - - -',
        'F5 - - A5 - - G5 - - E5 - -',
        'D5 - - E5 - - C5 - - - - .',
      ],
    },
    Square2: {
      inst: 'Soft',
      patterns: [
        'C4 - E4 - G4 - C4 - E4 - G4 -',
        'A3 - C4 - E4 - A3 - C4 - E4 -',
        'F3 - A3 - C4 - F3 - A3 - C4 -',
        'G3 - B3 - D4 - G3 - B3 - D4 -',
      ],
    },
    Triangle: {
      inst: 'Bass',
      patterns: ['C3 - - - - - G2 - - - - -', 'A2 - - - - - E2 - - - - -', 'F2 - - - - - C3 - - - - -', 'G2 - - - - - G2 - - B2 - -'],
    },
  },
};

// --- Song 1: "Petit pas" (stage). Bouncy, 16 steps per bar, C - Am - F - G. ---
const stage = {
  name: 'stage',
  noteLen: 8,
  patternLen: 16,
  order: [0, 1, 2, 3, 4, 5, 2, 6],
  channels: {
    Square1: {
      inst: 'Lead',
      patterns: [
        'C5 - E5 - G5 - E5 - C6 - - - G5 - . .',
        'A5 - G5 - E5 - C5 - E5 - - - . . . .',
        'F5 - A5 - C6 - A5 - G5 - F5 - E5 - . .',
        'D5 - E5 - F5 - D5 - G5 - - - - - . .',
        'E5 . E5 . G5 - C6 - B5 - G5 - E5 - . .',
        'A5 . A5 . C6 - A5 - G5 - E5 - C5 - . .',
        'D5 - G5 - B5 - D6 - C6 - - - - - . .',
      ],
    },
    Square2: {
      inst: 'Pluck',
      order: [0, 1, 2, 3, 0, 1, 2, 3],
      patterns: [
        'E4 . G4 . E4 . G4 . E4 . G4 . E4 . G4 .',
        'E4 . A4 . E4 . A4 . E4 . A4 . E4 . A4 .',
        'F4 . A4 . F4 . A4 . F4 . A4 . F4 . A4 .',
        'D4 . G4 . D4 . G4 . D4 . G4 . B4 . G4 .',
      ],
    },
    Triangle: {
      inst: 'Bass',
      order: [0, 1, 2, 3, 0, 1, 2, 3],
      patterns: [
        'C3 - . C3 - . G2 - C3 - . C3 - . G2 -',
        'A2 - . A2 - . E2 - A2 - . A2 - . E2 -',
        'F2 - . F2 - . C3 - F2 - . F2 - . C3 -',
        'G2 - . G2 - . D3 - G2 - . B2 - . D3 -',
      ],
    },
    Noise: {
      inst: 'Hat',
      order: [0, 0, 0, 1, 0, 0, 0, 1],
      patterns: [
        'C4:Kick . F#4 . D#5:Snare . F#4 . C4:Kick . F#4 . D#5:Snare . F#4 .',
        'C4:Kick . F#4 . D#5:Snare . F#4 . C4:Kick C4:Kick F#4 . D#5:Snare D#5:Snare D#5:Snare .',
      ],
    },
  },
};

// --- SFX (one "song" each). 0 jump, 1 pickup. ---
const sfxJump = {
  name: 'jump',
  noteLen: 2,
  patternLen: 8,
  order: [0],
  channels: { Square1: { inst: 'Pluck', patterns: ['C5 E5 G5 C6 E6 - . .'] } },
};
const sfxPickup = {
  name: 'pickup',
  noteLen: 3,
  patternLen: 8,
  order: [0],
  channels: { Square2: { inst: 'Lead', patterns: ['B5 E6 - - . . . .'] } },
};

mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, 'music.txt'), project('BLUM music', [title, stage]));
writeFileSync(path.join(outDir, 'sfx.txt'), project('BLUM sfx', [sfxJump, sfxPickup]));
console.log(`compose: wrote ${outDir}\\music.txt and sfx.txt`);

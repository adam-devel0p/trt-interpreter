import type { CardSeed } from '@/domain/decks/types';
import { court, pip } from './_builders';

/** RWS Wands (fire) and Cups (water). Sort blocks: wands 22–35, cups 36–49. */

const W = { suit: 'wands', suitLabel: 'Wands', base: 22 } as const;
const C = { suit: 'cups', suitLabel: 'Cups', base: 36 } as const;

export const RWS_WANDS: CardSeed[] = [
  pip({
    ...W,
    number: 1,
    astrology: 'Root of fire',
    correspondences: { notes: 'Root of the powers of fire' },
    up: ['inspiration', 'a spark', 'new energy', 'potential', 'desire'],
    rev: ['false start', 'delay', 'lack of drive', 'a spark that fizzles'],
    meaning:
      'The Ace of Wands suggests a fresh charge of energy — an idea, an appetite, a project that wants to begin. It tends to point to potential rather than a plan, and to the moment when enthusiasm is enough to move you. Consider what has recently lit up for you and whether you have given it room.',
    reversed:
      'Reversed, the Ace may suggest a start that has not caught, or enthusiasm that is not finding an outlet.',
    symbolism:
      'A hand emerges from a cloud gripping a sprouting wooden staff over a river valley with a castle in the distance; leaves fall from the wand like small flames.',
  }),
  pip({
    ...W,
    number: 2,
    astrology: 'Mars in Aries',
    correspondences: {
      decan: 'Mars in Aries · 1st decan (0°–10°)',
      planet: 'Mars',
      zodiac: 'Aries',
    },
    up: [
      'planning',
      'a wider view',
      'ambition',
      'a decision about direction',
      'the world in your hand',
    ],
    rev: ['fear of the unknown', 'a plan without action', 'limited horizons', 'indecision'],
    meaning:
      'The Two of Wands points to standing at the edge of what you have built and looking further. It often suggests a plan being weighed, an ambition that needs a direction, and the discomfort of a safe position that has become too small. Ask what you would do if the way were clear.',
    reversed:
      'Reversed, it may suggest a horizon that has narrowed, or a plan that stays a plan because leaving the wall feels too costly.',
    symbolism:
      'A man in a red cloak stands on a battlement holding a small globe in one hand and a staff in the other, a second staff fixed to the wall beside him, looking out over sea and mountains.',
  }),
  pip({
    ...W,
    number: 3,
    astrology: 'Sun in Aries',
    correspondences: {
      decan: 'Sun in Aries · 2nd decan (10°–20°)',
      planet: 'Sun',
      zodiac: 'Aries',
    },
    up: ['expansion', 'foresight', 'progress', 'ships coming in', 'commitment made'],
    rev: ['delays', 'obstacles', 'a plan gone off course', 'lack of foresight'],
    meaning:
      'The Three of Wands suggests that a decision has been made and its results are now on the way. It tends to point to patience after commitment — watching for what you set in motion, and readiness to receive it. One way to read it: the work of the moment is to hold position and keep looking outward.',
    reversed:
      'Reversed, the card may point to delays in what you were expecting, or to plans that did not account for the distance involved.',
    symbolism:
      'Seen from behind, a figure stands on a height between three staves, watching ships cross a golden sea. Everything that matters in the picture is far away and arriving.',
  }),
  pip({
    ...W,
    number: 4,
    astrology: 'Venus in Aries',
    correspondences: {
      decan: 'Venus in Aries · 3rd decan (20°–30°)',
      planet: 'Venus',
      zodiac: 'Aries',
    },
    up: ['celebration', 'homecoming', 'a milestone', 'community', 'stability'],
    rev: ['a private celebration', 'transition', 'lack of support', 'an unstable home'],
    meaning:
      'The Four of Wands points to a moment worth marking: a threshold crossed, a home made, a milestone reached with others. It often suggests welcome, safety and the pause that comes after a first stage of work is done. Consider what deserves celebrating before you move on.',
    reversed:
      'Reversed, it may suggest a milestone that arrives quietly or without the people you hoped for, or a home base that feels temporary.',
    symbolism:
      'Four staves support a garland of fruit and flowers before a castle; two figures raise bouquets in greeting while others gather behind. It is the deck’s clearest picture of welcome.',
  }),
  pip({
    ...W,
    number: 5,
    astrology: 'Saturn in Leo',
    correspondences: {
      decan: 'Saturn in Leo · 1st decan (0°–10°)',
      planet: 'Saturn',
      zodiac: 'Leo',
    },
    up: ['competition', 'friction', 'disagreement', 'sparring', 'many voices'],
    rev: ['avoiding conflict', 'tension released', 'inner conflict', 'agreement found'],
    meaning:
      'The Five of Wands suggests friction that is more noisy than dangerous. It tends to point to competition, clashing opinions, or several efforts pulling in different directions — the kind of struggle that can sharpen you if you do not take it personally. Ask what the disagreement is really about.',
    reversed:
      'Reversed, the card may point to conflict being avoided rather than resolved, or to the tension moving inward.',
    symbolism:
      'Five young men in mismatched clothes raise their staves against one another under a clear sky. Nobody is wounded; the fight looks more like practice than war.',
  }),
  pip({
    ...W,
    number: 6,
    astrology: 'Jupiter in Leo',
    correspondences: {
      decan: 'Jupiter in Leo · 2nd decan (10°–20°)',
      planet: 'Jupiter',
      zodiac: 'Leo',
    },
    up: ['recognition', 'success', 'a victory shared', 'confidence', 'progress acknowledged'],
    rev: ['delayed recognition', 'pride', 'a private win', 'a fall from favour'],
    meaning:
      'The Six of Wands points to success that others can see. It often suggests recognition, a public step forward, and the confidence that follows being met with approval. One way to read it: something you worked for is landing — notice who is celebrating with you and who is only watching.',
    reversed:
      'Reversed, it may suggest recognition withheld or delayed, or a victory that is rewarding you less than expected.',
    symbolism:
      'A rider crowned with laurel carries a staff also wreathed in laurel through a crowd of raised staves; the horse wears a green cloth and looks sideways at the viewer.',
  }),
  pip({
    ...W,
    number: 7,
    astrology: 'Mars in Leo',
    correspondences: { decan: 'Mars in Leo · 3rd decan (20°–30°)', planet: 'Mars', zodiac: 'Leo' },
    up: ['standing your ground', 'defence', 'perseverance', 'holding a position', 'challenge'],
    rev: ['overwhelm', 'giving way', 'exhaustion', 'a fight not worth having'],
    meaning:
      'The Seven of Wands suggests holding a position against pressure. It tends to point to defence rather than attack — protecting what you have gained, standing by a decision, refusing to be talked out of something. Consider whether the high ground you are on is worth the effort of keeping it.',
    reversed:
      'Reversed, the card may point to a defence that is wearing you down, or to a moment when yielding would cost less than continuing.',
    symbolism:
      'A man on a hilltop braces a staff against six others rising from below, wearing one boot and one shoe. He has the advantage of ground but is plainly outnumbered.',
  }),
  pip({
    ...W,
    number: 8,
    astrology: 'Mercury in Sagittarius',
    correspondences: {
      decan: 'Mercury in Sagittarius · 1st decan (0°–10°)',
      planet: 'Mercury',
      zodiac: 'Sagittarius',
    },
    up: ['speed', 'messages', 'movement', 'things in flight', 'quick developments'],
    rev: ['delays', 'haste', 'scattered energy', 'missed communications'],
    meaning:
      'The Eight of Wands points to things moving fast and all at once. It often suggests news arriving, decisions happening quickly, and a period where events outrun deliberation. One way to read it: the moment for planning has passed; the moment for responding well is here.',
    reversed:
      'Reversed, it may suggest movement stalled or messages crossing, or speed that has become carelessness.',
    symbolism:
      'Eight staves fly through clear air over a green landscape and a river, all angled the same way toward the ground. There are no people; the card is pure motion.',
  }),
  pip({
    ...W,
    number: 9,
    astrology: 'Moon in Sagittarius',
    correspondences: {
      decan: 'Moon in Sagittarius · 2nd decan (10°–20°)',
      planet: 'Moon',
      zodiac: 'Sagittarius',
    },
    up: ['resilience', 'wariness', 'the last stretch', 'guardedness', 'endurance'],
    rev: ['paranoia', 'giving up close to the end', 'burnout', 'defensiveness'],
    meaning:
      'The Nine of Wands suggests strength that has been tested and is still standing. It tends to point to the final push before a matter is settled, and to a guardedness earned through experience. Consider whether your wariness is protecting you or keeping you from finishing.',
    reversed:
      'Reversed, the card may point to defences raised against threats that have passed, or to exhaustion arriving just short of the end.',
    symbolism:
      'A bandaged man leans on a staff, looking back over his shoulder, with eight more staves planted in a row behind him like a fence. He is tired and still holding the line.',
  }),
  pip({
    ...W,
    number: 10,
    astrology: 'Saturn in Sagittarius',
    correspondences: {
      decan: 'Saturn in Sagittarius · 3rd decan (20°–30°)',
      planet: 'Saturn',
      zodiac: 'Sagittarius',
    },
    up: ['burden', 'overcommitment', 'responsibility', 'carrying too much', 'nearly there'],
    rev: ['setting things down', 'delegation', 'collapse under load', 'release'],
    meaning:
      'The Ten of Wands points to a load that has grown heavier than the reason for carrying it. It often suggests responsibility taken on willingly and now obscuring everything else, including the destination. One way to read it: ask which of these things you actually have to carry yourself.',
    reversed:
      'Reversed, it may suggest a burden being set down, shared, or dropped — sometimes by choice, sometimes not.',
    symbolism:
      'A figure bent double carries ten staves bundled in front of the face, walking toward a town not far away. The goal is in sight and hidden by the load.',
  }),
  court({
    ...W,
    rank: 'Page',
    rankIndex: 0,
    astrology: 'Earth of fire',
    correspondences: { sub_element: 'earth' },
    up: ['enthusiasm', 'a message', 'exploration', 'curiosity', 'a new idea'],
    rev: ['restlessness', 'hasty news', 'an idea without follow-through', 'immaturity'],
    meaning:
      'The Page of Wands suggests fresh enthusiasm that has not yet been tested. It often points to an idea, invitation or piece of news that brings a jolt of excitement — or to a part of you that is eager to start something. Consider what you are curious about right now, and what small first step it would take.',
    reversed:
      'Reversed, the Page may suggest excitement that scatters quickly, or news that arrives before it is fully formed.',
    symbolism:
      'A young person in a tunic patterned with salamanders holds a tall sprouting staff, gazing up at its tip, with pyramids on the desert horizon behind.',
  }),
  court({
    ...W,
    rank: 'Knight',
    rankIndex: 1,
    astrology: 'Air of fire',
    correspondences: { sub_element: 'air' },
    up: ['action', 'passion', 'impulsiveness', 'adventure', 'charging ahead'],
    rev: ['recklessness', 'frustration', 'a rush that goes nowhere', 'anger'],
    meaning:
      'The Knight of Wands points to energy that wants to act now. It tends to suggest boldness, appetite and a willingness to move before every question is answered — someone (perhaps you) who is exciting to be around and hard to slow down. Ask whether speed is what this situation needs.',
    reversed:
      'Reversed, the Knight may suggest impulsiveness without a target, or drive frustrated into irritation.',
    symbolism:
      'An armoured knight in a salamander-patterned surcoat rides a rearing horse across the desert, staff raised, plume streaming like flame.',
  }),
  court({
    ...W,
    rank: 'Queen',
    rankIndex: 2,
    astrology: 'Water of fire',
    correspondences: { sub_element: 'water' },
    up: ['warmth', 'confidence', 'magnetism', 'independence', 'generosity'],
    rev: ['jealousy', 'demanding attention', 'insecurity behind bravado', 'burnout'],
    meaning:
      'The Queen of Wands suggests warmth with backbone. She tends to point to confidence that draws people in, a capacity to hold many things at once without losing yourself, and a frank, generous way of being in charge. Consider where you are being asked to lead by being fully yourself.',
    reversed:
      'Reversed, the Queen may suggest confidence turned brittle, or warmth withdrawn when attention is not returned.',
    symbolism:
      'A queen sits on a throne carved with lions and sunflowers, a staff in one hand and a sunflower in the other, a black cat at her feet facing the viewer.',
  }),
  court({
    ...W,
    rank: 'King',
    rankIndex: 3,
    astrology: 'Fire of fire',
    correspondences: { sub_element: 'fire' },
    up: ['vision', 'leadership', 'boldness', 'entrepreneurial drive', 'honour'],
    rev: ['impatience', 'domineering', 'ruthlessness', 'a vision without care for others'],
    meaning:
      'The King of Wands points to vision matched with the authority to act on it. He often suggests leadership by example, big decisions made decisively, and a natural pull toward the long horizon. One way to read him: the situation is asking you to commit fully and take others with you.',
    reversed:
      'Reversed, the King may suggest leadership that has stopped listening, or ambition that treats people as means.',
    symbolism:
      'A king sits forward on a throne decorated with lions and salamanders, holding a flowering staff, a small salamander at his feet biting its own tail.',
  }),
];

export const RWS_CUPS: CardSeed[] = [
  pip({
    ...C,
    number: 1,
    astrology: 'Root of water',
    correspondences: { notes: 'Root of the powers of water' },
    up: ['emotional beginning', 'love', 'openness', 'compassion', 'overflow'],
    rev: ['emotional block', 'emptiness', 'repressed feeling', 'a love not received'],
    meaning:
      'The Ace of Cups suggests feeling that arrives before reasons. It tends to point to a new emotional opening — affection, compassion, creative flow, relief — and to the sense of having more to give than the moment requires. Consider what has softened in you recently.',
    reversed:
      'Reversed, the Ace may suggest feeling held back or unreturned, or a cup you are not letting anyone fill.',
    symbolism:
      'A hand from a cloud holds a chalice from which five streams pour into a lily pond; a dove descends carrying a wafer marked with a cross.',
  }),
  pip({
    ...C,
    number: 2,
    astrology: 'Venus in Cancer',
    correspondences: {
      decan: 'Venus in Cancer · 1st decan (0°–10°)',
      planet: 'Venus',
      zodiac: 'Cancer',
    },
    up: ['partnership', 'mutual attraction', 'connection', 'reconciliation', 'a pledge'],
    rev: ['imbalance', 'a breakdown in trust', 'miscommunication', 'a bond strained'],
    meaning:
      'The Two of Cups points to two people meeting as equals. It often suggests attraction, agreement, a friendship or alliance forming, or a rift being repaired with care. One way to read it: something is being offered in both directions at once.',
    reversed:
      'Reversed, the card may point to a connection that has become lopsided, or to two people no longer meaning the same thing by the same words.',
    symbolism:
      'A man and a woman exchange cups beneath a caduceus topped with a winged lion’s head; a house sits on the green hill behind them.',
  }),
  pip({
    ...C,
    number: 3,
    astrology: 'Mercury in Cancer',
    correspondences: {
      decan: 'Mercury in Cancer · 2nd decan (10°–20°)',
      planet: 'Mercury',
      zodiac: 'Cancer',
    },
    up: ['friendship', 'celebration', 'community', 'shared joy', 'support'],
    rev: ['overindulgence', 'gossip', 'exclusion', 'a group out of step'],
    meaning:
      'The Three of Cups suggests joy multiplied by company. It tends to point to friendship, celebration and the particular relief of being among people who are glad you are there. Consider who your people are in this matter, and whether you have let them in.',
    reversed:
      'Reversed, it may suggest a gathering that has curdled — too much of something, or a circle that has quietly closed against someone.',
    symbolism:
      'Three women in flowing dresses raise their cups together in a dance, fruit and gourds at their feet, in a harvest field.',
  }),
  pip({
    ...C,
    number: 4,
    astrology: 'Moon in Cancer',
    correspondences: {
      decan: 'Moon in Cancer · 3rd decan (20°–30°)',
      planet: 'Moon',
      zodiac: 'Cancer',
    },
    up: ['apathy', 'contemplation', 'discontent', 'an offer overlooked', 'withdrawal'],
    rev: ['renewed interest', 'accepting what is offered', 'coming out of a slump', 'motivation'],
    meaning:
      'The Four of Cups points to a flatness that keeps you from seeing what is being offered. It often suggests boredom, disappointment or a self-protective turning inward — and, quietly, a fourth cup that you have not looked at yet. Ask what you have been refusing without quite noticing.',
    reversed:
      'Reversed, the card may suggest attention returning, or a willingness to take what is offered even though it is not what you imagined.',
    symbolism:
      'A young man sits cross-armed beneath a tree, three cups before him, while a hand from a small cloud offers a fourth that he does not look at.',
  }),
  pip({
    ...C,
    number: 5,
    astrology: 'Mars in Scorpio',
    correspondences: {
      decan: 'Mars in Scorpio · 1st decan (0°–10°)',
      planet: 'Mars',
      zodiac: 'Scorpio',
    },
    up: ['loss', 'grief', 'regret', 'focusing on what is gone', 'what remains'],
    rev: ['acceptance', 'moving on', 'finding what is left', 'forgiveness'],
    meaning:
      'The Five of Cups suggests grief for what has spilled. It tends to point to loss, disappointment and the way attention fixes on what is gone — while two cups still stand behind you. One way to read it: the sorrow is real, and so is what remains.',
    reversed:
      'Reversed, it may suggest the beginning of acceptance — turning around, seeing the two upright cups, crossing the bridge.',
    symbolism:
      'A cloaked figure stands with head bowed over three spilled cups; two upright cups stand behind, and a bridge leads across a river to a house.',
  }),
  pip({
    ...C,
    number: 6,
    astrology: 'Sun in Scorpio',
    correspondences: {
      decan: 'Sun in Scorpio · 2nd decan (10°–20°)',
      planet: 'Sun',
      zodiac: 'Scorpio',
    },
    up: ['nostalgia', 'memory', 'innocence', 'kindness', 'the past returning'],
    rev: ['stuck in the past', 'idealised memories', 'refusing to grow up', 'letting go'],
    meaning:
      'The Six of Cups points to the past showing up in the present. It often suggests memory, familiarity, an old friend, or a simple kindness that carries more than it seems to. Consider what from earlier in your life is influencing this moment, and whether it helps.',
    reversed:
      'Reversed, the card may suggest a past that is being idealised, or a memory that needs to be set down so the present can be seen clearly.',
    symbolism:
      'In a walled garden a child hands another a cup filled with a white flower; four more cups stand in the foreground and a guard walks away in the distance.',
  }),
  pip({
    ...C,
    number: 7,
    astrology: 'Venus in Scorpio',
    correspondences: {
      decan: 'Venus in Scorpio · 3rd decan (20°–30°)',
      planet: 'Venus',
      zodiac: 'Scorpio',
    },
    up: ['fantasy', 'options', 'illusion', 'wishful thinking', 'too many choices'],
    rev: ['clarity', 'commitment', 'a choice made', 'disillusionment'],
    meaning:
      'The Seven of Cups suggests possibilities that are more attractive in the imagining than in the choosing. It tends to point to daydreams, temptations and options that dissolve when looked at closely — and to the difficulty of committing while everything is still possible. Ask which of these you would actually reach for.',
    reversed:
      'Reversed, it may suggest the fog clearing — one option becoming real, the rest recognised as smoke.',
    symbolism:
      'A silhouetted figure faces seven cups in a cloud, each holding a different vision: a face, a veiled figure, a serpent, a castle, jewels, a wreath, a dragon.',
  }),
  pip({
    ...C,
    number: 8,
    astrology: 'Saturn in Pisces',
    correspondences: {
      decan: 'Saturn in Pisces · 1st decan (0°–10°)',
      planet: 'Saturn',
      zodiac: 'Pisces',
    },
    up: [
      'walking away',
      'searching for more',
      'disillusionment',
      'leaving something whole',
      'a quest',
    ],
    rev: ['fear of leaving', 'aimless drifting', 'returning', 'avoiding the search'],
    meaning:
      'The Eight of Cups points to leaving something that is not broken because it is no longer enough. It often suggests a quiet departure, a search for meaning, and the melancholy of turning your back on what you built. One way to read it: what you are walking toward matters more than what you are leaving.',
    reversed:
      'Reversed, the card may suggest staying out of fear, or wandering without a direction that would justify the leaving.',
    symbolism:
      'A cloaked figure with a staff walks away from eight stacked cups toward mountains, under a moon that is both full and crescent.',
  }),
  pip({
    ...C,
    number: 9,
    astrology: 'Jupiter in Pisces',
    correspondences: {
      decan: 'Jupiter in Pisces · 2nd decan (10°–20°)',
      planet: 'Jupiter',
      zodiac: 'Pisces',
    },
    up: ['contentment', 'a wish fulfilled', 'satisfaction', 'comfort', 'enjoyment'],
    rev: ['smugness', 'dissatisfaction', 'materialism', 'a wish that disappoints'],
    meaning:
      'The Nine of Cups suggests satisfaction — the wish granted, the table laid. It tends to point to comfort, pleasure and a sense of having enough. Consider what you are content with right now, and whether the contentment is shared or kept behind you like the cups.',
    reversed:
      'Reversed, it may suggest satisfaction that has become complacency, or a wish that, once granted, turned out not to be the thing you needed.',
    symbolism:
      'A stout, pleased man sits with arms folded before a curved table on which nine cups stand in a row. He looks very much like a host.',
  }),
  pip({
    ...C,
    number: 10,
    astrology: 'Mars in Pisces',
    correspondences: {
      decan: 'Mars in Pisces · 3rd decan (20°–30°)',
      planet: 'Mars',
      zodiac: 'Pisces',
    },
    up: ['harmony', 'family', 'lasting happiness', 'belonging', 'emotional fulfilment'],
    rev: [
      'broken harmony',
      'a family under strain',
      'an ideal not matching reality',
      'disconnection',
    ],
    meaning:
      'The Ten of Cups points to emotional fulfilment shared with others. It often suggests home, family, lasting bonds and the feeling of having arrived somewhere that holds you. One way to read it: notice what makes this feel like home, and tend to it.',
    reversed:
      'Reversed, the card may suggest a harmony that exists more in the picture than in the house, or a family bond under strain.',
    symbolism:
      'A couple stand with arms raised beneath a rainbow of ten cups while two children dance beside them; a cottage and a river lie behind.',
  }),
  court({
    ...C,
    rank: 'Page',
    rankIndex: 0,
    astrology: 'Earth of water',
    correspondences: { sub_element: 'earth' },
    up: ['a message of feeling', 'creative beginnings', 'sensitivity', 'imagination', 'surprise'],
    rev: ['emotional immaturity', 'escapism', 'creative block', 'moodiness'],
    meaning:
      'The Page of Cups suggests a small, unexpected feeling worth attending to. It often points to a creative impulse, a tender message, or a surprise that asks you to stay open rather than knowing. Consider what is surfacing in you that you have not yet taken seriously.',
    reversed:
      'Reversed, the Page may suggest feeling that has no outlet, or a sensitivity that retreats into fantasy.',
    symbolism:
      'A young person in a floral tunic holds a cup from which a fish peers out, standing before a sea, regarding the fish with mild curiosity.',
  }),
  court({
    ...C,
    rank: 'Knight',
    rankIndex: 1,
    astrology: 'Air of water',
    correspondences: { sub_element: 'air' },
    up: ['romance', 'an offer', 'idealism', 'charm', 'following the heart'],
    rev: ['moodiness', 'unrealistic promises', 'disappointment', 'manipulation through charm'],
    meaning:
      'The Knight of Cups points to an approach made with feeling. It tends to suggest a proposal, an invitation, a romantic or artistic gesture, and the question of whether beauty is being matched by follow-through. Ask what is being offered, and what it would take to accept it.',
    reversed:
      'Reversed, the Knight may suggest promises that outrun intention, or feeling used as persuasion.',
    symbolism:
      'A knight in winged helmet rides a calm white horse at walking pace, holding a cup out before him, crossing a stream toward the viewer.',
  }),
  court({
    ...C,
    rank: 'Queen',
    rankIndex: 2,
    astrology: 'Water of water',
    correspondences: { sub_element: 'water' },
    up: ['compassion', 'emotional depth', 'intuition', 'care', 'calm'],
    rev: ['emotional overwhelm', 'codependence', 'martyrdom', 'insecurity'],
    meaning:
      'The Queen of Cups suggests deep feeling held with composure. She often points to empathy, emotional intelligence and the ability to sit with someone else’s pain without drowning in it. One way to read her: the situation asks for care that stays anchored.',
    reversed:
      'Reversed, the Queen may suggest feeling that has lost its shore — absorbing everyone else’s moods, or giving until nothing is left.',
    symbolism:
      'A queen sits on a throne at the water’s edge, gazing into an ornate closed cup, her robe merging with the sea at her feet.',
  }),
  court({
    ...C,
    rank: 'King',
    rankIndex: 3,
    astrology: 'Fire of water',
    correspondences: { sub_element: 'fire' },
    up: ['emotional maturity', 'diplomacy', 'balance', 'tolerance', 'wise counsel'],
    rev: ['emotional manipulation', 'volatility', 'coldness', 'repressed feeling'],
    meaning:
      'The King of Cups points to feeling governed but not suppressed. He tends to suggest steadiness under emotional weather, diplomacy, and the capacity to advise without being pulled off centre. Consider where calm authority over your own reactions would change the outcome.',
    reversed:
      'Reversed, the King may suggest control that has become coldness, or feelings managed by managing others.',
    symbolism:
      'A king sits on a stone throne floating on a restless sea, holding a cup and a sceptre, a fish leaping and a ship sailing behind him.',
  }),
];

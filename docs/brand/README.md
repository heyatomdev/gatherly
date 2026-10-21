# Gatherly — logo e uso

## 1. Il logo

- **Idea**: una **porta dentro una porta**. L'arco esterno è l'ingresso, quello pieno al centro è il
  posto che aspetta chi arriva. Gatherly è dove ci si ritrova: la soglia, non l'evento.
- **Versioni**: lockup orizzontale (simbolo + wordmark) · simbolo · simbolo *small* (per ≤ 32 px:
  gambe più spesse, intervallo più stretto).
- **Costruzione**: canvas 256, arco esterno gambe 36 (raggio 104), arco interno pieno (raggio 32),
  intervallo uguale allo spessore delle gambe (36), piedi sulla stessa linea di base (y 230).
- **Wordmark**: Inter Bold (SIL OFL), tracciato in path, cap height 112, tracking −3. Non ribattere
  il nome con un font.
- Rigenerare tutto: `python generate.py <Inter-Bold.ttf> .` (serve `resvg_py`, `fonttools`, `magick`).

## 2. File

| File | Uso |
|---|---|
| `gatherly-lockup.svg` · `-black` · `-white` · `-leaf` · `-mono-cdefd9` | README, documentazione, intestazioni |
| `gatherly-symbol.svg` · `-black` · `-white` · `-leaf` · `-mono-cdefd9` | simbolo ≥ 48 px |
| `gatherly-symbol-small.svg` · `-white` · `-mono-cdefd9` | simbolo 16–32 px (favicon, tab, box Meridian) |
| `gatherly-symbol-square.svg` | avatar/social: simbolo centrato su 256 con margine |
| `gatherly-symbol-app-icon.svg` | tile 22,5 % di raggio, verde foresta, simbolo menta |
| `gatherly-symbol-favicon.svg` | favicon vettoriale (taglio small, verde su chiaro, menta su scuro) |
| `gatherly-stream-deck-forest.svg` · `-dark` · `stream-deck/` | tasto Stream Deck: full bleed 288 (il tasto è già quadrato), simbolo al 60 %; PNG 288 e 144 |
| `png/` | lockup nero e leaf a 1000 px, simboli a 512 px, trasparenti |
| `web/` | `favicon.ico` (16/32/48), `favicon-*.png`, `apple-touch-icon.png`, `icon-192/512.png` |
| `../../app_logo.png` | lockup bianco su trasparente per il README |

`<head>` per le icone web:

```html
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/gatherly-symbol-favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
```

## 3. Spazio e dimensioni minime

- **Spazio libero**: tutt'intorno almeno lo spessore dell'arco esterno (36 su 256). Scala con il logo.
- **Minimi**: lockup 120 px di larghezza · simbolo 48 px · sotto 48 px usare il taglio *small*
  (16 px è il minimo).

## 4. Colore

| Nome | HEX | RGB | Uso |
|---|---|---|---|
| Foresta | `#0B2A1E` → `#14402E` | 11 42 30 → 20 64 46 | tile app icon e tasto Stream Deck (gradiente diagonale) |
| Menta | `#CDEFD9` | 205 239 217 | simbolo su Foresta e su scuro (`#0d1117`) |
| Foglia | `#1E5C41` | 30 92 65 | simbolo e lockup su sfondi chiari (contrasto AA) |
| Inchiostro | `#111111` | 17 17 17 | nero |
| Bianco | `#FFFFFF` | | su Foresta, app_logo |

Abbinamenti approvati: nero su bianco · foglia su bianco · bianco su Foresta · menta su Foresta o su
scuro. Un solo colore per volta nel simbolo: mai gradienti nel simbolo, ombre, contorni (il
gradiente è solo del tile).

**Il verde del brand non è l'accent di Meridian.** In Meridian `[data-svc="gatherly"]` resta Acqua
`#1EBEA9`: un verde foglia come accent cadrebbe a ridosso di Almanac, Beacon e dello stato *online*
(vedi budget delle tinte in `meridian/docs/DESIGN.md`). Il verde vive nel tile e nel logo.

**Box servizio in Meridian** (`ShellServiceCard`): simbolo `gatherly-symbol-small-mono-cdefd9.svg`
(tema scuro) o `-small.svg` in colore foglia `#1E5C41` (tema chiaro), sullo sfondo/bordo
dell'accent del servizio come gli altri.

## 5. Non fare

Non deformare · non ruotare · non staccare l'arco interno da quello esterno né cambiarne le
proporzioni · non ridisporre simbolo e wordmark · non usare il simbolo *small* sopra 32 px · non
ricolorare fuori palette · non mettere su sfondi mossi senza il tile.

## 6. Verifiche fatte

Render a 16/32/48 px, bianco/foglia/menta su chiaro e scuro, tile e Stream Deck. Non fatti: shelf
test contro altri loghi, specchio/180° formale, ricerca di marchio. Prima di un uso pubblico fuori
HeyAtom, verificare.

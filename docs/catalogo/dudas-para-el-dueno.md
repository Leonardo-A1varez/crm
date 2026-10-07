# Dudas del catálogo para el dueño — 2026-10-08

Ítems reales del catálogo (crm-dev, solo activos, los de más stock primero). Para cada sigla: cuántos ítems la usan, 4 ejemplos y **mi hipótesis** sacada de los datos — **no está confirmada**. Contestá al lado de cada una: "sí", "no, es …" o "no sé".

**Ya confirmado por vos:** DT = Datsun · MIT = Mitsubishi · VW = Volkswagen · FORD = Ford · DH = dirección hidráulica · DM = dirección mecánica · REPUESTO EMG y XELIM se eliminan.

**Pregunta aparte — "el grupo número 100":** en el ERP el grupo con código 100 es **BARRA CENTRAL** (36 ítems, es un repuesto de dirección). ¿Es ese el que hay que eliminar, o te referías a otra cosa (por ejemplo, los ítems que empiezan con un número, como `290 AMORTIGUADORES DEL CH TAOHE 2011`, que ya se eliminaron con REPUESTO EMG)?

---

## Marcas / vehículos

### DAI — 77 ítems — hipótesis: **Daihatsu** (Feroza y Terios son modelos Daihatsu)

| Ítem | Código        | Descripción                 | Grupo        | Marca/aux       | Stock | Precio |
| ---- | ------------- | --------------------------- | ------------ | --------------- | ----- | ------ |
| 6367 | M180A/2/      | DAI FEROZA TERIOS HC /HD/2/ | CHAQ BANCADA | +20             | 0     | $21,80 |
| 6389 | 13101-87113/0 | DAI HD FEROZA /0/           | PISTONES     | STD             | 0     | $59,92 |
| 6390 | 12910/0/      | DAI HD HC FEROZA /0/        | RINES        | STD 13011-87106 | 0     | $43,34 |
| 6364 | M180A/0/      | DAI FEROZA TERIOS HC /HD/0/ | CHAQ BANCADA | STD             | 0     | $25,83 |

### FESTIVA — 38 ítems — hipótesis: **Ford Festiva** (aparece como modelo compatible junto a Kia y Mazda)

| Ítem  | Código           | Descripción                         | Grupo          | Marca/aux    | Stock | Precio  |
| ----- | ---------------- | ----------------------------------- | -------------- | ------------ | ----- | ------- |
| 10392 | KHE41-15-171/K   | MZ 323 E3 E5 FESTIVA                | TERMOSTATOS    | KOREA        | 17    | $6,18   |
| 16725 | 49591-07010/CH   | KIA PICANTO 07-11 C/ABS FESTIVA 1.3 | HOMOC EXT      | MGT 24*20*52 | 6     | $33,01  |
| 9033  | 818033           | KIA PICANTO FESTIVA 1.3 24*20*52    | HOMOC EXT      | GHD          | 6     | $27,79  |
| 14021 | MB101-12-420/ORG | KIA SEPHIA FESTIVA                  | BARRA DE LEVAS | MOBIS        | 1     | $172,97 |

### CN — 6 ítems — vos dijiste "creo que Changan"; **los datos sugieren "vehículos chinos en general"** (Changhe, Chery, Great Wall)

| Ítem  | Código      | Descripción                               | Grupo              | Marca/aux                         | Stock | Precio  |
| ----- | ----------- | ----------------------------------------- | ------------------ | --------------------------------- | ----- | ------- |
| 15977 | 24531323/CH | CN CHANGHE FREECA MINI VAN 7P HAFEI MINYI | CABLES BUJIAS      | GHD                               | 17    | $13,43  |
| 16323 | S211109111  | CN CHERRY                                 | FILTRO AIRE        | —                                 | 2     | $10,81  |
| 15169 | 16011-E06   | CN GREAT WALL 2.8 DSL                     | EMBRAGUE KIT       | 16011-E06 PLATO 16012-00E06 DISCO | 0     | $172,44 |
| 12032 | 94463       | CN GREAT WALL                             | BANDA DISTRIBUCION | 124R                              | 0     | $42,86  |

---

## Abreviaturas

### TROM — 160 ítems — hipótesis: **trompo / bulbo (interruptor)** de aceite, de retro (reversa) y de stop

| Ítem  | Código          | Descripción                                        | Grupo       | Marca/aux | Stock | Precio |
| ----- | --------------- | -------------------------------------------------- | ----------- | --------- | ----- | ------ |
| 8871  | 90336039/ORG    | CH TAX AVEO LUV 2.2 DW LANOS                       | TROM ACEITE | GM        | 79    | $13,51 |
| 9120  | 96192077/CH     | CH TAX AVEO DW LAN CIEL RAC                        | TROM RETRO  | CHINA     | 74    | $4,57  |
| 16843 | 95368628/ORG    | CH TAX AVEO 2P SPARK GT OPTRA HB 06-               | TROM STOP   | GM        | 50    | $13,76 |
| 16983 | 93860-49600/ORG | HY ACC 12- CRET TQ RIO -18 CARN 2.9 FORT STA F 2.2 | TROM RETRO  | MOBIS     | 50    | $7,79  |

### B/FRENO — 40 ítems — hipótesis: **válvula de bomba de freno** (grupo `VALVULA B/FRENO`)

| Ítem  | Código          | Descripción               | Grupo           | Marca/aux          | Stock | Precio |
| ----- | --------------- | ------------------------- | --------------- | ------------------ | ----- | ------ |
| 23801 | 58775-2D100/ORG | HY ACC 12- VER MATRIX     | VALVULA B/FRENO | MOBIS              | 61    | $15,00 |
| 2041  | S08326392       | MZ 2.0 2.2 2.6 SEGURO ZAP | VALVULA B/FRENO | —                  | 3     | $0,78  |
| 10362 | 03492007        | DW RAC CIEL               | VALVULA B/FRENO | GRUESA_TOMA_GRUESA | 2     | $14,55 |
| 8822  | 11127           | CH LUV DIMAX RH           | VALVULA B/FRENO | 02134937           | 2     | $10,65 |

### TEMP — 14 ítems — hipótesis: **dos significados**: en `TEMPLADOR CADENA` es templador; en `BOCIN MESA SUSP` no sé ("TEMP TUBO POST")

| Ítem  | Código          | Descripción                        | Grupo                         | Marca/aux | Stock | Precio |
| ----- | --------------- | ---------------------------------- | ----------------------------- | --------- | ----- | ------ |
| 9337  | 55116-25000/K   | HY VER TEMP TUBO POST HUEC/PEQ     | BOCIN MESA SUSP               | KOREA     | 18    | $2,34  |
| 12004 | 55119-25000/K   | HY VER temp tubo post R/L          | BOCIN MESA SUSP               | KOREA     | 16    | $2,13  |
| 13361 | 55227-2D000/ORG | HY TUCSON 05- MATRIX 01- TEMP POST | BOCIN MESA SUSP               | MOBIS     | 9     | $2,44  |
| 19182 | 23360-4A030/ORG | KIA SORENT 2.5 TEMP CAD PRINC      | TEMPLADOR CADENA DISTRIBUCION | MOBIS     | 7     | $59,93 |

### C/C — 44 ítems (rulimanes) — hipótesis: **¿con cono? ¿con cubeta?**

| Ítem  | Código        | Descripción                   | Grupo            | Marca/aux | Stock | Precio |
| ----- | ------------- | ----------------------------- | ---------------- | --------- | ----- | ------ |
| 2624  | 30204/9071622 | CH SPARK MATIZ RP SAIL C/C    | RULIM SERIE 3000 | KBC       | 65    | $6,68  |
| 5323  | 30204-        | CH SPARK MATIZ RP SAIL C/C    | RULIM SERIE 3000 | 8D        | 40    | $6,06  |
| 21935 | 66/22         | CH SAIL 1.4 12- C/C 22*62*16  | RULIM VARIOS     | CHINA     | 31    | $29,70 |
| 12003 | TR285717G/K   | HY SONATA 04- C/C 28*57*13/17 | RULIM VARIOS     | KBC       | 29    | $7,89  |

### C/CAM — 108 ítems (rulimanes) — hipótesis: **¿con cámara? ¿con caucho?**

| Ítem  | Código          | Descripción                                      | Grupo            | Marca/aux      | Stock | Precio |
| ----- | --------------- | ------------------------------------------------ | ---------------- | -------------- | ----- | ------ |
| 18057 | 43222-32000/K   | HY ACC 10-18 CRETA RIO 18- STONIC C/CAM BR2865DT | RULIM VARIOS     | KBC            | 60    | $12,08 |
| 2671  | 6206 LLU        | CH TAX AVE C/CAM DW LAN MAZA                     | RULIM SERIE 6000 | 30*62*16       | 46    | $7,80  |
| 2676  | 6207/JP         | HY VER C/CAM SAIL XCITE ATOS X2                  | RULIM SERIE 6000 | 1A NTN         | 41    | $10,14 |
| 21758 | 43225-26AA0/ORG | KIA RIO 18- STONIC 20- CRETA CONO C/CAM 30BXW    | RULIM VARIOS     | MOBIS 30*60*19 | 37    | $28,69 |

### C/COR — 16 ítems — hipótesis: **con corona** (aparece escrito "C/CORONA")

| Ítem  | Código      | Descripción                                 | Grupo            | Marca/aux | Stock | Precio |
| ----- | ----------- | ------------------------------------------- | ---------------- | --------- | ----- | ------ |
| 4545  | 30306 C/K   | KIA PREGIO 3000 LUV 2.3 DMAX 2.5 x2 C/CORON | RULIM SERIE 3000 | KBC       | 10    | $33,75 |
| 12676 | TRO608A     | CH LUV TRO 3.2 V6 C/CORO                    | RULIM VARIOS     | —         | 3     | $27,19 |
| 7232  | HM-89449/10 | MT L200 92- C/COR                           | RULIM VARIOS     | —         | 3     | $23,60 |
| 2739  | R45Z-5ASA   | MZ 2.6 C/CORONA X2                          | RULIM VARIOS     | —         | 3     | $17,83 |

### C/R y S/R — 10 y 22 ítems (pistones) — hipótesis: **¿con/sin rines? ¿con/sin ranura?**

| Ítem  | Código           | Descripción             | Grupo    | Marca/aux              | Stock | Precio  |
| ----- | ---------------- | ----------------------- | -------- | ---------------------- | ----- | ------- |
| 12631 | 93396399/0.50    | CH COR 1.8 /2 EVOL C/R  | PISTONES | MALHE 80.5mm_1.2*1.2*2 | 2     | $173,34 |
| 374   | PA-2263 STD      | CH COR 1.3 /0 C/R       | PISTONES | 75mm_1.5*1.5*3         | 1     | $113,00 |
| 16305 | 8-93325-189/0.50 | CH DMAX 2.4 05-13/2 S/R | PISTONES | 87.5mm_1.2*1.5*2.5     | 10    | $66,50  |
| 13147 | 2865-BR02/3      | CH COR 1.8 /3 EVOL S/R  | PISTONES | 80.5mm_1.2*1.2*2       | 4     | $62,00  |

### ACT — 47 ítems (amortiguadores) — hipótesis: **no sé** (¿actualizado? ¿activo?)

| Ítem  | Código        | Descripción                        | Grupo        | Marca/aux | Stock | Precio |
| ----- | ------------- | ---------------------------------- | ------------ | --------- | ----- | ------ |
| 14113 | 55351-2E501/K | HY TUCS 05- LH GAS KIA SPORTAG ACT | AMORTIG POST | SUPER-MAX | 83    | $59,98 |
| 14114 | 55361-2E501/K | HY TUCS 05- RH GAS KIA SPORTAG ACT | AMORTIG POST | SUPER-MAX | 69    | $59,98 |
| 14581 | 54651-2E000/K | HY TUC 05- LH KIA SPORTAG ACT GAS  | AMORTIG DELT | SUPER-MAX | 43    | $52,61 |
| 14582 | 54661-2E000/K | HY TUC 05- RH KIA SPORTAG ACT GAS  | AMORTIG DELT | SUPER-MAX | 41    | $52,61 |

### ESP — 44 ítems — hipótesis: **¿especial?**

| Ítem | Código         | Descripción                                | Grupo                    | Marca/aux | Stock | Precio |
| ---- | -------------- | ------------------------------------------ | ------------------------ | --------- | ----- | ------ |
| 8861 | 96376569/ORG   | CH TAX AVEO CORSA DW CIEL LAN ESP 80*98*10 | RETEN CIGUEÑAL POST      | GM        | 55    | $11,52 |
| 4971 | 90467661/BR    | CH DMAX 2.4 05- LUV 2.2 DW ESP             | EMPAQUE TAPA VALVULAS    | SABO      | 39    | $2,59  |
| 9589 | 96101489 02702 | CH TAX AVEO CORSA DW CIEL LAN ESP 80*98*10 | RETEN CIGUEÑAL POST      | SABO      | 24    | $5,74  |
| 4137 | 6PK1885        | CH OPTRA TAC ESP                           | BANDA MULTIPLE ACANALADA | DONGIL    | 21    | $20,25 |

### COMP — 20 ítems — hipótesis: **completo** (o "compresor" según el grupo)

| Ítem  | Código        | Descripción                       | Grupo                        | Marca/aux | Stock | Precio  |
| ----- | ------------- | --------------------------------- | ---------------------------- | --------- | ----- | ------- |
| 17458 | 24537353/CH   | CH VAN N300 COMP                  | VOLANTE EMBRAGUE CINTA       | CHINA     | 3     | $45,62  |
| 24822 | 31110-2D030/K | HY ELANTRA 2004 BOMBA COMP GASOLI | BOMBA COMPLETA COMBUST INYEC | DAEWA     | 2     | $96,32  |
| 8331  | SK-502/CH     | SZ FORSA II COMP                  | HOMOC INT                    | GHD MACHO | 1     | $23,44  |
| 11450 | 16240269/K    | DW LANOS COMP                     | SEN COMPUT/CABLEADO          | —         | 0     | $250,00 |

### LATA — 19 ítems (bases de amortiguador) — hipótesis: **la base de lata (metálica)**

| Ítem  | Código          | Descripción                         | Grupo                 | Marca/aux | Stock | Precio |
| ----- | --------------- | ----------------------------------- | --------------------- | --------- | ----- | ------ |
| 20498 | 54627-2K000/K   | KIA PICANTO 18- HY I10 1.1 LATA     | BASE AMORTIGUADOR     | KOREA     | 94    | $1,67  |
| 19474 | 54627-07000/K   | HY ACC 12- DELT LATA                | BASE AMORTIGUADOR     | KOREA     | 15    | $1,50  |
| 20355 | 23354-42000/ORG | HY H1 TQ H100 DSL SEGURO PIÑON LATA | PINON DISTRIB B/ACEIT | MOBIS     | 14    | $6,50  |
| 17290 | 96415728/ORG    | CH SPARK 06- DELT LATA              | BASE AMORTIGUADOR     | GM        | 9     | $4,05  |

### PUPO — 10 ítems (tapas de radiador) — hipótesis: **tapa con "pupo" (válvula al centro)**

| Ítem  | Código               | Descripción                               | Grupo         | Marca/aux | Stock | Precio |
| ----- | -------------------- | ----------------------------------------- | ------------- | --------- | ----- | ------ |
| 15571 | 17920-66F01/AR       | CH GRAN VIT SZ 3/5P STEEM 1.1 MZ 2.2 PUPO | TAPA RADIADOR | CARLOSTAR | 31    | $3,20  |
| 3982  | KH-C31 16401-62092/J | CH GRAN VIT SZ 3/5P STEEM 1.1 MZ 2.2 PUPO | TAPA RADIADOR | SANKEI    | 28    | $3,94  |
| 8927  | 17920-66F01/OEM      | CH GRAN VIT SZ 3/5P STEEM 1.1 MZ 2.2 PUPO | TAPA RADIADOR | OEM       | 25    | $12,16 |
| 17743 | 17920-75F00/ORG      | CH GRAN VIT SZ 3/5P STEEM 1.1 MZ 2.2 PUPO | TAPA RADIADOR | SUZUKI    | 25    | $27,42 |

### BALANC — 158 ítems — hipótesis: **balancín** (grupo `BALANCINES`)

| Ítem  | Código          | Descripción                       | Grupo              | Marca/aux | Stock | Precio |
| ----- | --------------- | --------------------------------- | ------------------ | --------- | ----- | ------ |
| 20310 | 21421-33134/OEM | HY H1 TQ H100 DSL BALANC 25*35*6  | RETEN DISTRIBUCION | POS HY    | 160   | $4,24  |
| 22376 | 24551-2E001/ORG | HY TUCS IX 14- TL SONAT HYB       | BALANCINES         | MOBIS     | 63    | $4,22  |
| 20892 | 24531-4X100/K   | KIA CARNIVAL 2.9 HY TERR 2.9 16V  | BALANCINES         | KOREA     | 62    | $20,67 |
| 18097 | 24529-42501/K   | HY H1 TQ H100 DSL EX S/REGULACION | BALANCINES         | KOREA     | 50    | $7,00  |

### DISPONIBLE — 40 ítems — hipótesis: **grupo de relleno con piezas universales** ("UNIV …"). ¿Se ofrece o se elimina?

| Ítem | Código | Descripción               | Grupo      | Marca/aux | Stock | Precio |
| ---- | ------ | ------------------------- | ---------- | --------- | ----- | ------ |
| 8986 | 11-02  | UNIV RECTA 1/4 X 25CM     | DISPONIBLE | —         | 43    | $1,25  |
| 938  | 100CM  | UNIV VICTORIA             | DISPONIBLE | —         | 7     | $1,66  |
| 3610 | 92-433 | 1 UNIV REFORSADA 5/16x250 | DISPONIBLE | —         | 2     | $6,08  |
| 937  | 50CM   | UNIV VICTORIA             | DISPONIBLE | —         | 2     | $2,09  |

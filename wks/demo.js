"use strict";
/* Beispielinhalt: wird nur angezeigt, solange noch keine echten Unterlagen verarbeitet sind. */
const DEMO_VAULT = (() => {
  const d = n => { const x = new Date(); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
  return {v:1, beispiel:true, erstellt:new Date().toISOString(),
    faecher:[{id:"wg", name:"W&G", farbe:0, reihenfolge:1}, {id:"franzoesisch", name:"Französisch", farbe:2, reihenfolge:2}],
    themen:[
      {id:"t-bilanz", fach:"wg", titel:"Die Bilanz", tags:["rechnungswesen", "grundlagen"], quelle:"Beispiel", aktualisiert:d(-2),
        zusammenfassung:"Die Bilanz zeigt das Vermögen und das Kapital einer Unternehmung an einem Stichtag. Links stehen die [[Aktiven]], rechts die [[Passiven]].\n\nDie Aktiven sind nach Liquidität geordnet, die Passiven nach Fälligkeit. Die Summe beider Seiten ist immer gleich. Wie sich der Gewinn ergibt, zeigt die [[Erfolgsrechnung]].",
        kernpunkte:["Bilanz = Momentaufnahme an einem Stichtag", "Aktiven = Mittelverwendung, Passiven = Mittelherkunft", "Summe Aktiven = Summe Passiven"],
        begriffe:[{begriff:"Aktiven", erklaerung:"Vermögen der Unternehmung: Umlauf- und Anlagevermögen."}, {begriff:"Passiven", erklaerung:"Herkunft des Kapitals: Fremdkapital und Eigenkapital."}, {begriff:"Liquidität", erklaerung:"Wie schnell ein Vermögenswert zu Geld wird."}]},
      {id:"t-er", fach:"wg", titel:"Erfolgsrechnung", tags:["rechnungswesen"], quelle:"Beispiel", aktualisiert:d(-1),
        zusammenfassung:"Die Erfolgsrechnung stellt Aufwand und Ertrag einer Periode gegenüber. Ist der Ertrag grösser, entsteht ein Gewinn, sonst ein Verlust.\n\nDer Gewinn erhöht das Eigenkapital in der [[Die Bilanz|Bilanz]] und damit die [[Passiven]].",
        kernpunkte:["Zeitraumrechnung, nicht Stichtag", "Ertrag − Aufwand = Gewinn oder Verlust"],
        begriffe:[{begriff:"Aufwand", erklaerung:"Wertverzehr einer Periode, z. B. Löhne oder Miete."}, {begriff:"Ertrag", erklaerung:"Wertzuwachs einer Periode, z. B. Verkaufserlöse."}]},
      {id:"t-subj", fach:"franzoesisch", titel:"Le subjonctif", tags:["grammatik", "pruefung"], quelle:"Beispiel", aktualisiert:d(0),
        zusammenfassung:"Der Subjonctif steht nach Ausdrücken von Wunsch, Pflicht, Gefühl und Zweifel, zum Beispiel nach «il faut que» oder «je veux que».\n\nBildung: Stamm der 3. Person Plural Präsens (ils parlent → parl-) plus die Endungen -e, -es, -e, -ions, -iez, -ent.",
        kernpunkte:["Nach il faut que, vouloir que, avant que", "Stamm aus ils-Form + -e, -es, -e, -ions, -iez, -ent", "Unregelmässig: être, avoir, aller, faire"],
        begriffe:[{begriff:"Subjonctif", erklaerung:"Modus für Wunsch, Pflicht, Gefühl und Zweifel."}]},
    ],
    karten:[
      {id:"t-bilanz-k1", fach:"wg", thema:"t-bilanz", frage:"Wie sind die Aktiven geordnet?", antwort:"Nach Liquidität: zuerst Umlaufvermögen, dann Anlagevermögen."},
      {id:"t-bilanz-k2", fach:"wg", thema:"t-bilanz", frage:"Was zeigen die Passiven?", antwort:"Die Mittelherkunft: Fremdkapital und Eigenkapital."},
      {id:"t-er-k1", fach:"wg", thema:"t-er", frage:"Wie berechnet man den Erfolg?", antwort:"Ertrag minus Aufwand. Positiv = Gewinn, negativ = Verlust."},
      {id:"t-subj-k1", fach:"franzoesisch", thema:"t-subj", frage:"Il faut que tu … (venir)", antwort:"Il faut que tu viennes."},
      {id:"t-subj-k2", fach:"franzoesisch", thema:"t-subj", frage:"Wie bildet man den Stamm des Subjonctif?", antwort:"Aus der 3. Person Plural Präsens: ils parlent → parl-."},
    ],
    termine:[{id:"d-1", fach:"franzoesisch", titel:"Prüfung Subjonctif", art:"Prüfung", datum:d(9)}],
    status:null};
})();

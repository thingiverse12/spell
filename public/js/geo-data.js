/* =====================================================================
   Geografidata – världsdelar, länder, huvudstäder och kända städer.
   Allt på svenska. Länderna är valda så att de förekommer i
   mellanstadiet och högstadiet.
   ===================================================================== */

/* Länder skrivs som [land, huvudstad]. */
export const CONTINENTS = {
  asien: {
    name: 'Asien',
    icon: '🏯',
    note: 'Största världsdelen – från Turkiet till Japan.',
    countries: [
      ['Japan', 'Tokyo'],
      ['Kina', 'Peking'],
      ['Indien', 'New Delhi'],
      ['Sydkorea', 'Seoul'],
      ['Nordkorea', 'Pyongyang'],
      ['Thailand', 'Bangkok'],
      ['Vietnam', 'Hanoi'],
      ['Indonesien', 'Jakarta'],
      ['Filippinerna', 'Manila'],
      ['Malaysia', 'Kuala Lumpur'],
      ['Singapore', 'Singapore'],
      ['Pakistan', 'Islamabad'],
      ['Bangladesh', 'Dhaka'],
      ['Nepal', 'Katmandu'],
      ['Sri Lanka', 'Colombo'],
      ['Iran', 'Teheran'],
      ['Irak', 'Bagdad'],
      ['Saudiarabien', 'Riyadh'],
      ['Israel', 'Jerusalem'],
      ['Turkiet', 'Ankara'],
      ['Afghanistan', 'Kabul'],
      ['Kazakstan', 'Astana'],
      ['Mongoliet', 'Ulaanbaatar'],
      ['Kambodja', 'Phnom Penh'],
      ['Myanmar', 'Naypyidaw'],
      ['Förenade Arabemiraten', 'Abu Dhabi']
    ],
    cities: [
      ['Mumbai', 'Indien'],
      ['Osaka', 'Japan'],
      ['Shanghai', 'Kina'],
      ['Dubai', 'Förenade Arabemiraten'],
      ['Chiang Mai', 'Thailand'],
      ['Busan', 'Sydkorea'],
      ['Isfahan', 'Iran'],
      ['Surabaya', 'Indonesien']
    ]
  },
  europa: {
    name: 'Europa',
    icon: '🏛️',
    note: 'Sverige och våra grannländer – och resten av kontinenten.',
    countries: [
      ['Sverige', 'Stockholm'],
      ['Norge', 'Oslo'],
      ['Danmark', 'Köpenhamn'],
      ['Finland', 'Helsingfors'],
      ['Island', 'Reykjavik'],
      ['Tyskland', 'Berlin'],
      ['Frankrike', 'Paris'],
      ['Spanien', 'Madrid'],
      ['Portugal', 'Lissabon'],
      ['Italien', 'Rom'],
      ['Grekland', 'Aten'],
      ['Polen', 'Warszawa'],
      ['Tjeckien', 'Prag'],
      ['Slovakien', 'Bratislava'],
      ['Nederländerna', 'Amsterdam'],
      ['Belgien', 'Bryssel'],
      ['Österrike', 'Wien'],
      ['Schweiz', 'Bern'],
      ['Irland', 'Dublin'],
      ['Storbritannien', 'London'],
      ['Ungern', 'Budapest'],
      ['Rumänien', 'Bukarest'],
      ['Kroatien', 'Zagreb'],
      ['Serbien', 'Belgrad'],
      ['Bulgarien', 'Sofia'],
      ['Estland', 'Tallinn'],
      ['Lettland', 'Riga'],
      ['Litauen', 'Vilnius'],
      ['Ukraina', 'Kiev'],
      ['Slovenien', 'Ljubljana']
    ],
    cities: [
      ['Göteborg', 'Sverige'],
      ['Malmö', 'Sverige'],
      ['Barcelona', 'Spanien'],
      ['Milano', 'Italien'],
      ['München', 'Tyskland'],
      ['Edinburgh', 'Storbritannien'],
      ['Marseille', 'Frankrike'],
      ['Kraków', 'Polen'],
      ['Bergen', 'Norge'],
      ['Åbo', 'Finland']
    ]
  },
  amerika: {
    name: 'Amerika',
    icon: '🗽',
    note: 'Från Kanada i norr till Argentina i söder.',
    countries: [
      ['USA', 'Washington D.C.'],
      ['Kanada', 'Ottawa'],
      ['Mexiko', 'Mexico City'],
      ['Guatemala', 'Guatemala City'],
      ['Honduras', 'Tegucigalpa'],
      ['Nicaragua', 'Managua'],
      ['El Salvador', 'San Salvador'],
      ['Costa Rica', 'San José'],
      ['Panama', 'Panama City'],
      ['Kuba', 'Havanna'],
      ['Jamaica', 'Kingston'],
      ['Haiti', 'Port-au-Prince'],
      ['Dominikanska republiken', 'Santo Domingo'],
      ['Colombia', 'Bogotá'],
      ['Venezuela', 'Caracas'],
      ['Ecuador', 'Quito'],
      ['Peru', 'Lima'],
      ['Brasilien', 'Brasília'],
      ['Bolivia', 'La Paz'],
      ['Chile', 'Santiago'],
      ['Argentina', 'Buenos Aires'],
      ['Uruguay', 'Montevideo'],
      ['Paraguay', 'Asunción'],
      ['Guyana', 'Georgetown']
    ],
    cities: [
      ['New York', 'USA'],
      ['Los Angeles', 'USA'],
      ['Chicago', 'USA'],
      ['Rio de Janeiro', 'Brasilien'],
      ['São Paulo', 'Brasilien'],
      ['Montréal', 'Kanada'],
      ['Medellín', 'Colombia'],
      ['Cusco', 'Peru']
    ]
  },
  afrika: {
    name: 'Afrika',
    icon: '🦁',
    note: '54 länder – här är de vanligaste i skolan.',
    countries: [
      ['Egypten', 'Kairo'],
      ['Marocko', 'Rabat'],
      ['Algeriet', 'Alger'],
      ['Tunisien', 'Tunis'],
      ['Libyen', 'Tripoli'],
      ['Sudan', 'Khartoum'],
      ['Etiopien', 'Addis Abeba'],
      ['Kenya', 'Nairobi'],
      ['Tanzania', 'Dodoma'],
      ['Uganda', 'Kampala'],
      ['Nigeria', 'Abuja'],
      ['Ghana', 'Accra'],
      ['Senegal', 'Dakar'],
      ['Elfenbenskusten', 'Yamoussoukro'],
      ['Kamerun', 'Yaoundé'],
      ['Kongo-Kinshasa', 'Kinshasa'],
      ['Angola', 'Luanda'],
      ['Zambia', 'Lusaka'],
      ['Zimbabwe', 'Harare'],
      ['Moçambique', 'Maputo'],
      ['Sydafrika', 'Pretoria'],
      ['Namibia', 'Windhoek'],
      ['Botswana', 'Gaborone'],
      ['Madagaskar', 'Antananarivo'],
      ['Somalia', 'Mogadishu'],
      ['Rwanda', 'Kigali']
    ],
    cities: [
      ['Alexandria', 'Egypten'],
      ['Kapstaden', 'Sydafrika'],
      ['Durban', 'Sydafrika'],
      ['Marrakech', 'Marocko'],
      ['Tanger', 'Marocko'],
      ['Lagos', 'Nigeria'],
      ['Mombasa', 'Kenya']
    ]
  }
};

/** Världsdelarnas namn i den ordning de visas. */
export const CONTINENT_KEYS = ['asien', 'europa', 'amerika', 'afrika'];

export const CONTINENT_NAMES = CONTINENT_KEYS.map((key) => CONTINENTS[key].name);

/** Alla länder (med världsdelsnyckel) – används för blandade frågor. */
export const ALL_COUNTRIES = CONTINENT_KEYS.flatMap((key) =>
  CONTINENTS[key].countries.map(([country, capital]) => ({ country, capital, continent: key }))
);

/** Alla städer (med land och världsdel). */
export const ALL_CITIES = CONTINENT_KEYS.flatMap((key) =>
  CONTINENTS[key].cities.map(([city, country]) => ({ city, country, continent: key }))
);

export const continentName = (key) =>
  key === 'blandat' ? 'Blandat' : CONTINENTS[key] ? CONTINENTS[key].name : 'Geografi';

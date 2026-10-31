import type { Category } from './types';

// 10 sample gigs in Darija across all 8 Oran neighborhoods. Created by admin
// via the admin page ("Add sample gigs") so the app never launches empty.
// Each sample is removable in one tap from the admin queue.
export interface SampleGig {
  title: string;
  description: string;
  category: Category;
  payMin: number;
  payMax: number;
  neighborhood: string;
}

export const SAMPLE_GIGS: SampleGig[] = [
  {
    title: 'Nlawjou 3la 2 kheddamin l werch bina — Bir El Djir',
    description:
      'Werch bina f Bir El Djir ye7taj 2 chabbab: t7mil, tekhlet, tna9i. Khlas 2500–3000 DZD l youm (8h–17h). Ila 3andek l experience, contactini.',
    category: 'construction',
    payMin: 2500,
    payMax: 3000,
    neighborhood: 'Bir El Djir'
  },
  {
    title: 'Coursier b moto — Es Sénia',
    description:
      'Restaurant f Es Sénia ye7taj coursier b moto bach yewassel les commandes. Khlas 1500–2000 DZD l youm + tips. Moto kheddama 3liha.',
    category: 'delivery',
    payMin: 1500,
    payMax: 2000,
    neighborhood: 'Es Sénia'
  },
  {
    title: 'Tandif f dar kol semana — Canastel',
    description:
      'Nhebb we7da tetna9i dar (3 byout) f Canastel, marra wa7da f semana. 2000 DZD kol marra (4 swa3e).',
    category: 'cleaning',
    payMin: 2000,
    payMax: 2000,
    neighborhood: 'Canastel'
  },
  {
    title: 'Ostad math l weldi — Maraval',
    description:
      'Nlawwej 3la ostad(a) math bach y9arri weldi (3eme année moyenne) f dar f Maraval. 800–1200 DZD l session, 2 sessions f semana.',
    category: 'tutoring',
    payMin: 800,
    payMax: 1200,
    neighborhood: 'Maraval'
  },
  {
    title: 'Serveur jeune — restaurant f Gambetta',
    description:
      'Restaurant 3ayeli f Gambetta ye7taj serveur jeune, surtout weekend. Khlas 35.000 DZD ch her. Ylezzemou ykoun khdamma w ser3a.',
    category: 'restaurant',
    payMin: 35000,
    payMax: 35000,
    neighborhood: 'Gambetta'
  },
  {
    title: '2 chabbab l mounasabat — El Hamri',
    description:
      'Nlawjou 3la 2 chabbab y3awnou f t7dir o service f 3rasat (mounasabat) f El Hamri. 3000 DZD l mounasaba. Weekend ghaliban.',
    category: 'events',
    payMin: 3000,
    payMax: 3000,
    neighborhood: 'El Hamri'
  },
  {
    title: 'Design logo l projet jdid — Ain El Turk',
    description:
      'Nhebb wa7ed ydir liya logo w identité basique l projet jdid taw3i. Ila 3andek portfolio, contactini. Khlas 2000–4000 DZD 7sab l khedma.',
    category: 'digital',
    payMin: 2000,
    payMax: 4000,
    neighborhood: 'Ain El Turk'
  },
  {
    title: 'Tandif magasin f sbah — Wahran El Jadida',
    description:
      'Magasin f Wahran El Jadida ye7taj wa7ed yetna9i kol youm f sbah (1h). 1500 DZD l youm.',
    category: 'cleaning',
    payMin: 1500,
    payMax: 1500,
    neighborhood: 'Wahran El Jadida'
  },
  {
    title: 'Montage vidéos TikTok — remote',
    description:
      'Nlawwej 3la wa7ed ydir montage vidéos courts l TikTok w Reels. 3000 DZD l video. Khedma remote — ghir 3lik l phone.',
    category: 'digital',
    payMin: 3000,
    payMax: 3000,
    neighborhood: 'Bir El Djir'
  },
  {
    title: 'Peintre appartement — Es Sénia',
    description:
      'Nhebb peintre bach ypeinti appartement 2 byout f Es Sénia. 4000–5000 DZD l youm, khedma 2–3 youm. El peinture 3liya ana.',
    category: 'construction',
    payMin: 4000,
    payMax: 5000,
    neighborhood: 'Es Sénia'
  }
];

# Notification Platform — objašnjeno kao da imaš 5 godina

Ovaj fajl postoji da bi ti (ili bilo ko drugi ko prvi put otvori ovaj repo) mogao da pročita
ovaj dokument od vrha do dna i razume **šta ovaj projekat radi, zašto je napravljen ovako
kako je, i šta tačno radi svaki fajl**. Ići ćemo polako, fajl po fajl, liniju po liniju gde
treba, sa analogijama iz svakodnevnog života.

---

## 1. Šta je ovo uopšte? (velika slika)

Zamisli da imaš restoran sa dostavom. Kada neko naruči hranu:

1. Neko uzme porudžbinu na kasi (**gateway**).
2. Porudžbina se zapiše na papirić (**baza podataka**).
3. Papirić ide na traku koja vodi u kuhinju (**Kafka** — sistem za slanje poruka).
4. U kuhinji, jedan kuvar pravi picu (**email-worker**), drugi pravi burgere
   (**webhook-worker**) — svako gleda samo svoje porudžbine.
5. Ako nešto ode po zlu (nestane struje, kuvar ispusti tanjir), neko mora da se vrati i
   pokuša ponovo kasnije (**retry-scheduler**).

Ovaj projekat je tačno to, samo umesto hrane šalje **notifikacije** — email-ove i webhook
pozive (to je kad jedan kompjuterski program pozove drugi da mu kaže "desilo se nešto").

**Svrha projekta:** ovo je "event-driven" (vođen događajima) sistem za slanje notifikacija,
napravljen kao portfolio/job-search projekat — znači, napravljen da pokaže da ume da se
napravi ozbiljan, realan sistem kakav koriste prave kompanije: sa Kafkom, bazom, Redis-om,
Docker-om, Kubernetes-om i Helm-om.

Glavna ideja iza arhitekture: **nikad ne sme da se izgubi notifikacija**, čak i ako nešto
usput pukne (padne Kafka, padne baza, padne worker). To se postiže pomoću šablona koji se
zove **transactional outbox** (objašnjeno dole, u sekciji 4).

---

## 2. Od čega je sastavljen projekat (4 male aplikacije)

Ovo je **Nx monorepo** — jedan git repo, ali unutra živi više odvojenih aplikacija koje dele
zajednički kod. Zamisli jednu veliku kuću sa 4 različite firme koje rade unutra, ali sve
koriste isto parkiralište i isti frižider (zajednički kod).

Te 4 aplikacije (svaka je zaseban Node.js proces koji se pokreće i gasi nezavisno):

| Aplikacija                          | Šta radi                                                                 | Analogija                                   |
| ----------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------- |
| [gateway](gateway/)                 | Prima HTTP zahteve "pošalji notifikaciju", upisuje u bazu, gura na Kafka | Kasa u restoranu                            |
| [email-worker](email-worker/)       | Sluša Kafka, šalje email-ove                                             | Kuvar za pice                               |
| [webhook-worker](webhook-worker/)   | Sluša Kafka, zove tuđe URL-ove (webhook pozive)                          | Kuvar za burgere                            |
| [retry-scheduler](retry-scheduler/) | Svake 2 sekunde proverava da li nešto treba ponovo da se pošalje         | Konobar koji proverava zakasnele porudžbine |

I zajednički kod koji svi dele, u [libs/](libs/):

- [libs/contracts](libs/contracts/) — zajednički "rečnik" (tipovi podataka)
- [libs/database](libs/database/) — konekcija ka Postgres bazi
- [libs/redis](libs/redis/) — konekcija ka Redis-u
- [libs/kafka](libs/kafka/) — konekcija ka Kafka-i

---

## 3. Zajednički rečnik — `libs/contracts`

Pre nego što pričamo o bilo čemu drugom, moramo da pričamo o **rečniku**. Zamisli da gateway
i email-worker pričaju telefonom — moraju da se dogovore na kom jeziku pričaju, inače jedan
kaže "pošalji mi ime" a drugi čuje nešto sasvim drugo.

[libs/contracts/src/lib/notification-events.ts](libs/contracts/src/lib/notification-events.ts):

```ts
export type NotificationChannel = 'EMAIL' | 'WEBHOOK';

export interface NotificationRequestedEvent {
  eventId: string;
  notificationId: string;
  tenantId: string;
  channel: NotificationChannel;
  recipient: string;
  payload: Record<string, unknown>;
  createdAt: string;
}
```

Ovo je **oblik poruke** koja putuje kroz Kafku. Svaki put kad gateway kaže "hej, treba poslati
notifikaciju", pošalje tačno ovaj oblik podataka:

- `eventId` — jedinstveni broj baš ove poruke (ne iste notifikacije — ako se ista notifikacija
  pošalje ponovo, broj poruke je drugačiji, ali `notificationId` ostaje isti)
- `notificationId` — koja notifikacija je u pitanju (red u bazi)
- `channel` — da li ide mejlom ili kao webhook
- `recipient` — kome ide (email adresa ili URL)
- `payload` — sadržaj (tema, telo mejla, ili bilo šta za webhook)

I email-worker i webhook-worker **uvoze baš ovaj isti tip** (`import type { NotificationRequestedEvent } from '@org/contracts'`), tako da ako gateway nešto promeni u obliku poruke, TypeScript odmah vrišti greškom u svim worker-ima koji to koriste — ne možeš da zabrljaš i pošalješ pogrešan oblik a da niko ne primeti.

---

## 4. Baza podataka — `prisma/schema.prisma` (srce čitavog sistema)

Ovo je **najvažniji fajl u celom projektu** da razumeš. Ovde je definisano gde se sve čuva.

[prisma/schema.prisma](prisma/schema.prisma) koristi **Prisma** — to je alat koji ti dozvoljava
da opišeš tabele u bazi kao obične TypeScript-olike definicije, a on sam generiše sav kod
potreban da sa bazom pričaš iz Node.js-a (umesto da ručno pišeš SQL svaki put).

Dve tabele:

### Tabela `Notification` (jedna notifikacija = jedan red)

```prisma
model Notification {
  id             String             @id @default(uuid())
  tenantId       String
  channel        NotificationChannel
  recipient      String
  payload        Json
  status         NotificationStatus @default(PENDING)
  attempts       Int                @default(0)
  idempotencyKey String?            @unique
  lastError      String?
  nextRetryAt    DateTime?
  createdAt      DateTime           @default(now())
  updatedAt      DateTime           @updatedAt
}
```

Zamisli ovo kao papirić koji prati jednu porudžbinu kroz ceo restoran, od kase do stola:

- `status` ima 5 mogućih vrednosti: `PENDING` (čeka), `PROCESSING` (upravo se šalje),
  `RETRYING` (nije uspelo, čeka novi pokušaj), `DELIVERED` (uspešno isporučeno),
  `FAILED` (definitivno nije uspelo, odustali smo)
- `attempts` — koliko puta je pokušano da se pošalje
- `idempotencyKey` — objašnjeno u sekciji 6, ovo sprečava duplikate
- `nextRetryAt` — "ne diraj me pre ovog vremena", koristi ga retry-scheduler

### Tabela `OutboxEvent` (red za slanje na Kafku)

```prisma
model OutboxEvent {
  id          String            @id @default(uuid())
  topic       String
  payload     Json
  status      OutboxEventStatus @default(PENDING)
  attempts    Int               @default(0)
  lastError   String?
  createdAt   DateTime          @default(now())
  publishedAt DateTime?
}
```

Ovo je **najpametniji deo celog projekta** i zove se **transactional outbox pattern**
(transakcioni "izlazni sandučić"). Objašnjenje zašto postoji:

**Problem koji rešava:** zamisli da gateway uradi ovo u dva koraka:

1. Upiše notifikaciju u bazu ("zapamti da treba poslati mejl")
2. Pošalje poruku na Kafku ("hej, workeri, obradite ovo")

Šta ako gateway uspe korak 1, ali **baš u tom trenutku** (struja, mreža, restart) ne stigne
da uradi korak 2? Notifikacija je zapisana u bazi, ali **niko nikad neće saznati da treba da
je pošalje** — zauvek zaglavljena, izgubljena. To je užasan bug koji je skoro nemoguće uhvatiti
jer se desi retko i nasumično.

**Rešenje:** umesto da odmah šalje na Kafku, gateway upiše OBA reda u ISTOJ bazi transakciji —
i `Notification` red i `OutboxEvent` red se upisuju zajedno, kao jedna atomska operacija (ili
oba uspeju, ili ni jedno). Vidi to u koraku 6 ([notifications.service.ts](gateway/src/app/notifications/notifications.service.ts)):

```ts
const notification = await this.prisma.$transaction(async (tx) => {
  const createdNotification = await tx.notification.create({ data: { ... } });

  await tx.outboxEvent.create({
    data: {
      topic: 'notification.requested',
      payload: event,
    },
  });

  return createdNotification;
});
```

Posle toga, jedan poseban servis ([OutboxRelayService](gateway/src/app/outbox/outbox-relay.service.ts),
objašnjen u sekciji 6.4) svake 2 sekunde gleda u `OutboxEvent` tabelu i šalje na Kafku sve što
tamo čeka. Ako Kafka padne, `OutboxEvent` red ostaje `PENDING` zauvek dok Kafka ne proradi —
**ništa se ne gubi**, jer je zapisano u bazi, ne samo "poslato u vazduh".

---

## 5. Zajednički alati — `libs/database`, `libs/redis`, `libs/kafka`

### 5.1. `libs/database` — konekcija ka Postgres bazi

[libs/database/src/lib/prisma.service.ts](libs/database/src/lib/prisma.service.ts):

```ts
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is not defined');
    }
    super({ adapter: new PrismaPg({ connectionString }) });
  }

  async ping(timeoutMs = 2000): Promise<void> {
    // ... Promise.race između SELECT 1 i timeout-a
  }
}
```

Ovo je mala "omotnica" oko Prisma klijenta. Svaka od 4 aplikacije je ubacuje (dependency
injection — NestJS "ubrizgava" ovaj objekat gde god je potreban, bez da se ručno pravi novi
svaki put) i tako prave upite ka bazi.

`ping()` metoda je bitna: koristi se **samo** za health check-ove (sekcija 10). Umesto da
samo uradi `SELECT 1` i čeka (što bi moglo da visi zauvek ako je baza zaglavljena), koristi
`Promise.race` — "trkaj se" `SELECT 1` protiv tajmera od 2 sekunde, i ko prvi završi, taj
pobeđuje. Ako baza ne odgovori za 2 sekunde, `ping()` baca grešku — tako Kubernetes brzo
sazna "ova instanca ne radi" umesto da čeka u beskraj.

### 5.2. `libs/redis` — konekcija ka Redis-u

[libs/redis/src/lib/redis.ts](libs/redis/src/lib/redis.ts) — Redis je baza koja čuva sve u
memoriji (RAM-u), pa je munjevito brza, ali ništa ne čuva trajno kad se ugasi (za razliku od
Postgres-a koji čuva na disku). Koristi se za stvari koje moraju biti brze i ne moraju trajati
zauvek:

```ts
async setIfNotExists(key: string, value: string, ttlSeconds: number): Promise<boolean> {
  const result = await this.client.set(key, value, 'EX', ttlSeconds, 'NX');
  return result === 'OK';
}
```

`NX` znači "postavi samo ako već ne postoji" — ovo je **atomska** operacija (ne može niko
drugi da se ubaci između provere i upisa). Ovo se koristi za idempotentnost (sekcija 6.2) i
rate limiting (sekcija 6.3).

### 5.3. `libs/kafka` — konekcija ka Kafka-i

Kafka je sistem za slanje poruka — zamisli ga kao jako pouzdan poštanski sandučić koji nikad
ne gubi pisma, čak i ako pošta (server) nakratko padne.

[libs/kafka/src/lib/kafka.service.ts](libs/kafka/src/lib/kafka.service.ts) — ovo koristi
**samo gateway**, da ŠALJE poruke (producer):

```ts
async publish<T>(topic: string, payload: T): Promise<void> {
  await lastValueFrom(this.client.emit(topic, payload));
}
```

[libs/kafka/src/lib/kafka-consumer.options.ts](libs/kafka/src/lib/kafka-consumer.options.ts) —
ovo koriste email-worker i webhook-worker, da SLUŠAJU poruke (consumer):

```ts
export function createKafkaConsumerOptions({
  clientId,
  groupId,
  fromBeginning = true,
}) {
  const brokers = process.env.KAFKA_BROKERS;
  if (!brokers) throw new Error('KAFKA_BROKERS is not defined');

  return {
    transport: Transport.KAFKA,
    options: {
      client: { clientId, brokers: brokers.split(',') },
      consumer: { groupId },
      subscribe: { fromBeginning },
    },
  };
}
```

Bitan koncept: **`groupId`**. Email-worker ima `groupId: 'email-worker-group'`, webhook-worker
ima `groupId: 'webhook-worker-group'`. Kafka garantuje da svaka poruka na jednoj temi (topic)
stigne **do svake grupe tačno jednom**, ali unutar jedne grupe, ako imaš više kopija (replika)
istog worker-a, poruke se dele među njima (svaka poruka ide samo jednoj kopiji). Ovo je kako
email-worker i webhook-worker oba čitaju istu temu `notification.requested`, a da se ne
"otimaju" o poruke.

---

## 6. Gateway — ulazna vrata sistema

Gateway je NestJS HTTP aplikacija. Kad se pokrene, [main.ts](gateway/src/main.ts) kaže:

```ts
app.setGlobalPrefix('api'); // sve rute počinju sa /api
await app.listen(port); // podrazumevano 3000
```

### 6.1. Primanje zahteva — `notifications.controller.ts`

[gateway/src/app/notifications/notifications.controller.ts](gateway/src/app/notifications/notifications.controller.ts):

```ts
@Controller('notifications')
export class NotificationsController {
  @Post()
  create(
    @Body() dto: CreateNotificationDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.notificationsService.create(dto, idempotencyKey);
  }
}
```

Ovo znači: `POST /api/notifications` sa JSON telom. Telo mora da prođe proveru oblika
([create-notification.dto.ts](gateway/src/app/notifications/dto/create-notification.dto.ts)):

```ts
export class CreateNotificationDto {
  @IsIn(['EMAIL', 'WEBHOOK'])
  channel!: 'EMAIL' | 'WEBHOOK';

  @IsString()
  @IsNotEmpty()
  recipient!: string;

  @IsObject()
  payload!: Record<string, unknown>;
}
```

Ako pošalješ `channel: "SMS"` (ne postoji), ili zaboraviš `recipient`, NestJS automatski
vraća grešku `400 Bad Request` pre nego što uopšte stigne do tvog koda — to radi
`ValidationPipe` postavljen u [main.ts](gateway/src/main.ts).

### 6.2. Idempotentnost — "ne pošalji mi istu notifikaciju dva puta"

Zamisli: tvoj internet se seca baš kad šalješ zahtev. Ne znaš da li je server primio zahtev
ili ne, pa pošalješ isti zahtev ponovo "za svaki slučaj". Bez zaštite, sad imaš **dve iste
notifikacije** poslate korisniku. Idempotentnost to sprečava.

[notifications.service.ts](gateway/src/app/notifications/notifications.service.ts), metoda
`create()`:

```ts
const reserved = await this.redis.setIfNotExists(
  redisKey,
  JSON.stringify({ status: 'PROCESSING', notificationId }),
  this.idempotencyTtlSeconds, // 24h
);

if (!reserved) {
  // Neko je VEĆ poslao zahtev sa ovim istim idempotency-key headerom!
  return this.handleExistingIdempotencyKey(redisKey);
}
```

Klijent šalje header `Idempotency-Key: neki-jedinstveni-string` uz zahtev. Gateway pokuša da
"rezerviše" taj ključ u Redis-u pomoću `setIfNotExists` (`NX` iz sekcije 5.2) — ako ključ VEĆ
postoji, znači da je neko već poslao isti zahtev, pa gateway **ne kreira novu notifikaciju**,
nego vraća isti odgovor kao prvi put (ili čeka da prvi zahtev završi, ako je još u toku —
to proverava i u bazi, za slučaj da je Redis zapamtio "u toku" ali je proces u međuvremenu
pukao posle commit-a u bazu).

### 6.3. Rate limiting — "ne dozvoli da nas neko preplavi"

[rate-limit.service.ts](gateway/src/app/notifications/rate-limit/rate-limit.service.ts):

```ts
async check(tenantId: string): Promise<void> {
  const window = Math.floor(Date.now() / 60_000);  // koji je trenutni minut
  const key = `rate-limit:${tenantId}:${window}`;

  const count = await this.redis.increment(key);
  if (count === 1) await this.redis.expire(key, 60);

  if (count > 100) {
    throw new HttpException('Rate limit exceeded', HttpStatus.TOO_MANY_REQUESTS);
  }
}
```

Ovo je "fiksni prozor" rate limiter: svaki minut dobija svoj Redis ključ (npr.
`rate-limit:demo-tenant:29234567`), i svaki zahtev ga poveća za 1. Ako u istom minutu stigne
više od 100 zahteva za istog tenant-a (= korisnika/firmu koja koristi platformu), dobija
HTTP 429 (Too Many Requests). Posle minuta, ključ istekne sam (TTL) i broji se ispočetka.

### 6.4. Slanje na Kafku u pozadini — `OutboxRelayService`

Ovo je implementacija "outbox pattern"-a iz sekcije 4.
[outbox-relay.service.ts](gateway/src/app/outbox/outbox-relay.service.ts):

```ts
const POLL_INTERVAL_MS = 2000;
const BATCH_SIZE = 20;
const MAX_ATTEMPTS = 10;

onModuleInit(): void {
  this.timer = setInterval(() => void this.poll(), POLL_INTERVAL_MS);
}
```

Svake 2 sekunde, ovaj servis se probudi i "ugrabi" do 20 čekajućih poruka iz `OutboxEvent`
tabele:

```sql
UPDATE "OutboxEvent"
SET status = 'PUBLISHING'
WHERE id IN (
  SELECT id FROM "OutboxEvent"
  WHERE status = 'PENDING'
  ORDER BY "createdAt" ASC
  LIMIT 20
  FOR UPDATE SKIP LOCKED
)
RETURNING id, topic, payload, attempts;
```

`FOR UPDATE SKIP LOCKED` je **ključni deo SQL-a** ovde: ako imaš više kopija gateway-a
(replika) istovremeno pokrenutih, svaka od njih pokušava da "ugrabi" redove u isto vreme.
`SKIP LOCKED` kaže Postgres-u: "ako je neki red već zaključan od strane druge kopije koja ga
upravo obrađuje, samo ga preskoči i uzmi sledeći" — umesto da čeka ili da dve kopije pošalju
istu poruku dva puta. Ovo je kako sistem radi ispravno čak i kad imaš više replika gateway-a
(bitno za buduće skaliranje, sekcija 12).

Posle slanja na Kafku, red se označi kao `PUBLISHED`. Ako slanje ne uspe, broj pokušaja se
poveća; posle 10 neuspešnih pokušaja, red se trajno označi kao `FAILED` (odustaje se).

### 6.5. Health check — `/api/health`, `/api/health/live`, `/api/health/ready`

[health.controller.ts](gateway/src/app/health/health.controller.ts) — ovo postoji **samo za
Kubernetes** (ili Docker healthcheck), da zna da li da restartuje gateway ili da li da mu šalje
saobraćaj.

```ts
@Get('ready')
async ready() {
  const [database, redis] = await Promise.all([
    this.prisma.ping().then(up, down),
    this.redis.ping().then(up, down),
  ]);
  // ako je database ILI redis down -> 503 Service Unavailable
}
```

Bitna odluka ovde: **`ready()` namerno NE proverava Kafku**. Zašto? Zato što ceo smisao
outbox pattern-a (sekcija 4) je da gateway MOŽE da primi zahtev i upiše ga u bazu čak i kad
je Kafka privremeno nedostupna — poruka samo čeka u `OutboxEvent` tabeli dok se Kafka ne
vrati. Da proveravamo Kafku u `ready()`, gateway bi se nepotrebno proglasio "neispravnim"
i prestao da prima bilo kakve zahteve, iako savršeno može da radi svoj posao (upiše u bazu).

---

## 7. Email worker — šalje mejlove

Ovo je "hibridna" NestJS aplikacija: nema svoj javni HTTP API za korisnike, ali ima **dva**
paralelna "ulaza":

1. Kafka consumer — pravi posao (čita poruke, šalje mejlove)
2. Mali HTTP server — SAMO za `/health` i `/ready`, da ga Kubernetes može proveriti

[email-worker/src/main.ts](email-worker/src/main.ts):

```ts
const app = await NestFactory.create(AppModule);

app.connectMicroservice<MicroserviceOptions>(
  createKafkaConsumerOptions({
    clientId: 'email-worker',
    groupId: 'email-worker-group',
  }),
);

// Prvo osluškuj HTTP (da /health odgovara dok se Kafka konekcija tek uspostavlja)
await app.listen(process.env.HEALTH_PORT ?? 3001);
await app.startAllMicroservices();
app.get(HealthState).markConsumerReady();
```

Primećuješ redosled: prvo HTTP sluša, PA TEK ONDA se poveže Kafka consumer. Ovo je namerno —
`/health` (liveness, "da li je proces živ") treba da odgovori ODMAH, čak i dok se Kafka
consumer još uvek pokušava da se poveže (što može trajati par sekundi). Tek kad se consumer
stvarno pridruži Kafka grupi, poziva se `markConsumerReady()`, i tek tad `/ready` kaže "OK".

### 7.1. Obrada poruke — `email.controller.ts`

[email.controller.ts](email-worker/src/app/email/email.controller.ts):

```ts
@EventPattern('notification.requested')
async handleNotification(@Payload() event: NotificationRequestedEvent): Promise<void> {
  if (event.channel !== 'EMAIL') {
    return;  // ovo nije za nas, webhook-worker će to obraditi
  }
  // ...
}
```

Bitno: **i email-worker i webhook-worker slušaju ISTU temu** (`notification.requested`), ali
svaki samo obradi poruke koje su za njega (proveri `channel`). Zašto nije napravljeno da
imaju odvojene teme (`notification.email` i `notification.webhook`)? Jednostavnije je za sada
— jedna tema, filtriranje u kodu. (Moglo bi se promeniti kasnije, ali trenutno radi dobro jer
je skala mala.)

Dalje:

```ts
const notification = await this.prisma.notification.findUnique({
  where: { id: notificationId },
});

if (notification.status === 'DELIVERED') {
  this.logger.log(`already delivered, skipping redelivered event`);
  return;
}
```

Ovo je **zaštita od duplog slanja mejla**. Kafka ponekad (retko, ali se dešava) pošalje istu
poruku dva puta (to se zove "at-least-once delivery" — Kafka garantuje da poruka NEĆE biti
izgubljena, ali ne garantuje da neće stići dvaput). Ako je notifikacija već `DELIVERED`,
worker je jednostavno ignoriše drugi put — korisnik ne dobija dva ista mejla.

```ts
await this.prisma.notification.update({
  data: { status: 'PROCESSING', attempts: { increment: 1 } },
});
await this.emailService.sendEmail(event.recipient, event.payload);
await this.prisma.notification.update({
  data: { status: 'DELIVERED', lastError: null },
});
```

Ako `sendEmail` baci grešku (npr. mejl server ne radi), upada u `catch` blok i status postaje
`FAILED` (trenutno email-worker nema retry logiku — to je ostavljeno samo webhook-workeru i
retry-scheduleru, pogledaj sekciju 8 i 9).

### 7.2. Stvarno slanje — `email.service.ts`

[email.service.ts](email-worker/src/app/email/email.service.ts) koristi biblioteku
`nodemailer` da se poveže na SMTP server (u razvoju/testu to je **Mailpit** — lažni mejl
server koji samo hvata mejlove u svoj web interfejs da ih vidiš, ne šalje ih stvarno nikome):

```ts
this.transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: false,
});
```

---

## 8. Webhook worker — poziva tuđe URL-ove (+ retry sa exponential backoff)

Skoro identičan email-workeru po strukturi (isti `main.ts` obrazac, isti health check
obrazac), ali sa jednom **velikom razlikom**: webhook-worker ima **pravu retry logiku sa
exponential backoff-om** (eksponencijalno sve dužim čekanjem između pokušaja).

[webhook.controller.ts](webhook-worker/src/app/webhook.controller.ts), metoda `recordFailure`:

```ts
const attemptIndex = current.attempts - 1;

if (attemptIndex < 5) {
  const baseDelay = Math.pow(2, attemptIndex) * 1000; // 1s, 2s, 4s, 8s, 16s...
  const jitter = Math.floor(Math.random() * 500); // + do 500ms nasumično
  const nextRetryAt = new Date(Date.now() + baseDelay + jitter);

  await this.prisma.notification.update({
    data: { status: 'RETRYING', lastError: message, nextRetryAt },
  });
  return;
}

// 5 pokušaja iscrpljeno -> trajno odustajemo
await this.prisma.notification.update({
  data: { status: 'FAILED', nextRetryAt: null },
});
```

Objašnjenje **exponential backoff-a** (eksponencijalno čekanje): ako webhook poziv ne uspe
(npr. tuđi server je privremeno pao), ne pokušavaš odmah ponovo (to bi ga samo dodatno
zatrpalo) — čekaš sve duže i duže između pokušaja:

- 1. neuspeh → čekaj ~1 sekundu
- 2. neuspeh → čekaj ~2 sekunde
- 3. neuspeh → čekaj ~4 sekunde
- 4. neuspeh → čekaj ~8 sekundi
- 5. neuspeh → čekaj ~16 sekundi
- 6. neuspeh → odustani trajno (`FAILED`)

**`jitter`** (nasumičan dodatak do 500ms) je bitan detalj: zamisli da 1000 webhook poziva
padne u isto vreme (npr. tuđi server je pao na trenutak) — bez jitter-a, SVIH 1000 bi pokušalo
ponovo u TAČNO isti milisekund, ponovo zatrpavajući server čim se vrati. Jitter "razmrsi"
pokušaje u vremenu da se ne dese svi odjednom.

Primećuješ da se ovde samo **postavlja `nextRetryAt` i status `RETRYING`** — webhook-worker
sam ne čeka i ne pokušava ponovo. To posao retry-scheduler-a (sekcija 9).

[webhook.service.ts](webhook-worker/src/app/webhook.service.ts) — stvarni HTTP poziv:

```ts
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 10_000);

const response = await fetch(url, {
  method: 'POST',
  body: JSON.stringify(payload),
  signal: controller.signal,
});

if (!response.ok) throw new Error(`Webhook returned HTTP ${response.status}`);
```

Ima **timeout od 10 sekundi** — ako tuđi server ne odgovori za 10 sekundi, poziv se prekida
(`AbortController`) i tretira se kao neuspeh (ide u retry logiku iznad). Bez ovoga, worker bi
mogao zauvek da visi čekajući odgovor od spor/mrtvog servera.

---

## 9. Retry scheduler — "probudi se svake 2 sekunde i proveri zakasnele"

Ovo je najmanja aplikacija — nema HTTP API za korisnike, nema Kafka consumer. Samo jedan
**cron job** (zadatak koji se ponavlja na tajmer).

[retry-scheduler/src/app/app.service.ts](retry-scheduler/src/app/app.service.ts):

```ts
@Cron('*/2 * * * * *')  // svake 2 sekunde
async processRetries(): Promise<void> {
  this.lastTickAtMs = Date.now();

  const notifications = await this.prisma.notification.findMany({
    where: { status: 'RETRYING', nextRetryAt: { lte: new Date() } },
    take: 50,
  });

  for (const notification of notifications) {
    await this.scheduleRetry(notification.id);
  }
}
```

Svake 2 sekunde pita bazu: "ima li notifikacija koje čekaju retry i čije je vreme već stiglo
(`nextRetryAt <= sada`)?" Za svaku takvu notifikaciju:

```ts
await this.prisma.$transaction(async (tx) => {
  const updated = await tx.notification.updateMany({
    where: { id: notificationId, status: 'RETRYING', nextRetryAt: { lte: new Date() } },
    data: { status: 'PENDING', nextRetryAt: null },
  });

  if (updated.count !== 1) return;  // neko je drugi već to uradio pre nas

  // ponovo kreiraj OutboxEvent -> ide opet na Kafku -> webhook-worker pokušava ponovo
  await tx.outboxEvent.create({ data: { topic: 'notification.requested', payload: { ... } } });
});
```

Zašto `updateMany` sa `WHERE status: 'RETRYING'` umesto običnog `update`? Ovo je zaštita od
trke (race condition) ako bi ikad bilo više kopija retry-scheduler-a pokrenuto istovremeno —
`updateMany` vraća koliko je redova stvarno promenjeno; ako je `0` (neki drugi proces je to
već promenio u međuvremenu), ovaj proces jednostavno odustaje umesto da duplo zakaže retry.

Ovo ponovo koristi **isti outbox pattern** iz sekcije 4 — ne šalje direktno na Kafku, nego
upisuje novi `OutboxEvent` red u istoj transakciji, a `OutboxRelayService` u gateway-u (sekcija
6.4) će ga pokupiti i poslati. **Čekaj — zar retry-scheduler nema svoj OutboxRelayService?**
Ne — on samo piše u `OutboxEvent` tabelu. Isti `OutboxRelayService` iz gateway-a (koji
non-stop radi svoje polling-ovanje) će pokupiti i ove nove redove, bez obzira ko ih je
napisao.

### 9.1. Health check koji proverava da li cron STVARNO kuca

[retry-scheduler/src/app/health/health.controller.ts](retry-scheduler/src/app/health/health.controller.ts):

```ts
const MAX_TICK_AGE_MS = 30_000;  // cron kuca svake 2s; ako 30s nije kucnuo, nešto je zaglavljeno

@Get('health')
live() {
  const lastTickAgeMs = Date.now() - this.retryService.lastTickAt;
  if (lastTickAgeMs > MAX_TICK_AGE_MS) {
    throw new ServiceUnavailableException({ status: 'unavailable', lastTickAgeMs });
  }
  return { status: 'ok', lastTickAgeMs };
}
```

Ovo je pametan detalj: obično liveness check samo proveri "da li je proces živ" (npr. da li
HTTP server odgovara). Ali ovde bi se moglo desiti da je HTTP server živ i odgovara, a da je
cron posao nekako interno zaglavljen/umro (npr. zbog neuhvaćenog izuzetka u nekoj petlji) — i
tad bi Kubernetes mislio "sve je OK" zauvek, dok u stvarnosti retry mehanizam uopšte ne radi.
Zato se ovde pamti **vreme poslednjeg "kucanja" cron posla** (`lastTickAtMs`, ažurira se na
POČETKU svakog `processRetries()` poziva, čak i ako sam posao kasnije pukne na grešci) i
liveness proverava da li je prošlo više od 30 sekundi otkad je kucnuo — ako jeste, nešto je
zaglavljeno i Kubernetes treba da restartuje pod.

---

## 10. Health check-ovi — zajednička filozofija kroz ceo projekat

Primetio si da svaka aplikacija ima `/health` (ili `/live`) i `/ready`. Ovo nije slučajno —
ovo su dva **različita** koncepta koje Kubernetes razlikuje:

- **Liveness** (`/health`, `/live`) — "da li treba da me ubiješ i ponovo pokreneš?" Ovde se
  NIKAD ne proverava baza/Kafka/Redis, jer restart procesa ne može da popravi "baza je pala".
  Restartovanje zdravog procesa samo zato što je baza privremeno nedostupna bi samo pravilo
  štetu (nepotrebni restart-restart ciklus, tzv. "crash loop").
- **Readiness** (`/ready`) — "da li treba da ti šaljem saobraćaj baš sad?" Ovde SE proveravaju
  zavisnosti, jer ako baza ne radi, nema smisla slati zahteve ovoj instanci — ali proces se
  NE restartuje, samo se privremeno izbacuje iz "load balancer" rotacije dok se zavisnost ne
  vrati.

Svaka aplikacija ima svoju varijaciju ove filozofije prilagođenu svom poslu (gateway namerno
ignoriše Kafku u `/ready`, retry-scheduler proverava cron tick u `/health` umesto baze) — sve
detaljno objašnjeno gore, sekcije 6.5, 7, 9.1.

---

## 11. Docker — pakovanje svake aplikacije u kutiju

### 11.1. `docker-compose.yml` (razvojna verzija)

[docker-compose.yml](docker-compose.yml) pokreće SAMO infrastrukturu (Kafka, Mailpit, Redis)
— aplikacije (gateway, workeri) se tada pokreću ručno na tvom računaru komandom
`pnpm nx serve gateway` i slično, da možeš da ih menjaš i odmah vidiš promene bez rebuild-a
Docker image-a.

### 11.2. `docker-compose.prod.yml` (pun "proizvodni" stek)

[docker-compose.prod.yml](docker-compose.prod.yml) pokreće **baš sve**, uključujući sve 4
aplikacije, svaku izgrađenu iz svog Dockerfile-a. Par bitnih detalja ovde (svaki je bio
stvarni bug koji je uhvaćen i popravljen tokom rada na projektu):

**Problem 1 — Kafka "advertised listeners":**

```yaml
KAFKA_LISTENERS: INTERNAL://:19092,EXTERNAL://:9092,CONTROLLER://:9093
KAFKA_ADVERTISED_LISTENERS: INTERNAL://kafka:19092,EXTERNAL://localhost:9092
```

Kafka ima čudno ponašanje: kad se klijent prvi put poveže, Kafka mu kaže "ok, ali za SVE
dalje pozive, pričaj sa adresom X" (to je "advertised listener"). Ako bi Kafka rekla svima
`localhost:9092`, to radi dobro sa tvog računara (`localhost` = tvoj računar), ali NE radi iz
drugog kontejnera (`localhost` iz kontejnera = taj isti kontejner, ne Kafka!). Rešenje: dva
odvojena "ulaza" — `INTERNAL` (adresa `kafka:19092`, za kontejnere međusobno) i `EXTERNAL`
(adresa `localhost:9092`, za tebe sa host računara).

**Problem 2 — topic mora postojati PRE nego consumer pokuša da se poveže:**

```yaml
kafka-topics-init:
  depends_on:
    kafka:
      condition: service_healthy
  command: >-
    kafka-topics.sh --create --if-not-exists --topic notification.requested ...
```

Ako email-worker pokuša da se poveže na temu koja još ne postoji, dobije grešku
`UNKNOWN_TOPIC_OR_PARTITION` i padne. Zato postoji poseban kontejner koji SAMO napravi temu i
onda se ugasi (`service_completed_successfully`), a tek onda se pokreću gateway i workeri
(`depends_on: kafka-topics-init: condition: service_completed_successfully`).

**Problem 3 — Kafka image radi kao ne-root korisnik:**

```yaml
kafka-data-init:
  image: busybox
  command: ['sh', '-c', 'chown -R 1000:1000 /data']
  volumes:
    - kafka-data:/data
```

Docker volume (`kafka-data`) se podrazumevano pravi kao vlasništvo `root` korisnika, ali
Kafka image radi kao korisnik sa ID-jem 1000 (ne root, iz bezbednosnih razloga). Bez ovog
"chown" koraka, Kafka bi pukla na `AccessDeniedException` čim pokuša da upiše svoj prvi
fajl. Ovaj mali `busybox` kontejner se pokrene, promeni vlasnika foldera, i odmah se ugasi
— samo da pripremi teren pre nego što prava Kafka krene.

**Health check-ovi u Compose-u** koriste `wget` da pozovu baš te `/health`/`/ready` rute iz
sekcije 10, npr:

```yaml
healthcheck:
  test: ['CMD-SHELL', 'wget -qO /dev/null http://127.0.0.1:3001/ready']
```

### 11.3. Dockerfile-ovi (svaki od 4)

[gateway/Dockerfile](gateway/Dockerfile) kao primer — koristi **multi-stage build** (gradnja u
dve faze):

```dockerfile
FROM node:22-alpine AS build
RUN pnpm install --frozen-lockfile
RUN pnpm exec nx build gateway
RUN pnpm prune --prod

FROM node:22-alpine AS runtime
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist/gateway ./dist/gateway
CMD ["node", "dist/gateway/main.js"]
```

Prva faza (`build`) instalira SVE zavisnosti (uključujući one potrebne samo za build, kao
TypeScript kompajler), izgradi aplikaciju, pa onda `pnpm prune --prod` obriše sve što nije
potrebno za RAD aplikacije (samo build-alati). Druga faza (`runtime`) kopira SAMO ono što je
stvarno potrebno iz prve faze — konačna slika je mnogo manja jer ne nosi sa sobom čitav
build-toolchain, samo gotov kod i zavisnosti za pokretanje.

---

## 12. CI pipeline — `.github/workflows/ci.yml`

[.github/workflows/ci.yml](.github/workflows/ci.yml):

```yaml
on:
  push:
    branches: [main]
  pull_request:

jobs:
  main:
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v5
      - run: pnpm install --frozen-lockfile
      - run: npx nx format:check --base="remotes/origin/main"
      # - run: npx nx run-many -t lint test build typecheck e2e
```

Na svaki push na `main` i na svaki pull request, GitHub Actions pokrene ovaj posao. Trenutno
proverava SAMO formatiranje koda (`format:check` — da li je kod propisno formatiran po
Prettier pravilima). Linija za `lint test build typecheck e2e` je zakomentarisana — znači
trenutno se NE pokreću automatski testovi, linting ili build provera u CI-u (to je nešto što
bi moglo da se uključi kasnije).

**Bitna gotcha koju smo uhvatili:** Prettier ne ume da pročita Helm template fajlove (jer
sadrže `{{ }}` sintaksu koja nije validan YAML sam po sebi), i pošto Nx pokreće JEDAN veliki
Prettier poziv za SVE izmenjene fajlove odjednom, jedan nepodržan fajl ruši proveru za CEO
repo. Zato [.prettierignore](.prettierignore) ima liniju `infra/helm/**/templates/**` —
Helm template-i se validiraju drugim alatima (`helm lint`, `helm template`), ne Prettier-om.

---

## 13. Kubernetes (raw manifesti) — `infra/k8s/`

Ovo su "sirovi" (ručno pisani) YAML fajlovi koji govore Kubernetes-u kako da pokrene ceo
sistem u klasteru (lokalno testirano na `kind` — Kubernetes-in-Docker, lokalni mini-klaster).

Struktura: [infra/k8s/namespace.yaml](infra/k8s/namespace.yaml) pravi "odeljak"
`notification-platform` u klasteru (sve ostalo živi unutra, izolovano od drugih projekata u
istom klasteru). [infra/k8s/configmap.yaml](infra/k8s/configmap.yaml) drži ne-tajne
konfiguracione vrednosti (adrese servisa) koje svi pod-ovi dele.

Svaka aplikacija ima svoj folder (`gateway/`, `email-worker/`, `webhook-worker/`,
`retry-scheduler/`, `redis/`, `mailpit/`, `kafka/`) sa `deployment.yaml` (kaže "pokreni N
kopija ovog kontejnera") i `service.yaml` (kaže "ovako se ove kopije zovu unutar klastera,
npr. `gateway:3000`").

Kafka je poseban slučaj — koristi **StatefulSet** umesto Deployment-a
([infra/k8s/kafka/statefulset.yaml](infra/k8s/kafka/statefulset.yaml)), jer Kafka čuva
podatke na disku i treba joj **stabilan identitet** (uvek isto ime pod-a, `kafka-0`, čak i
posle restarta) — za razliku od običnih aplikacija (gateway, workeri) koje su "bezstatusne"
(stateless) i mogu se slobodno gasiti/paliti/umnožavati bez brige o identitetu.

Bitni detalji u Kafka StatefulSet-u (svaki je bio uhvaćen uživo bug na pravom klasteru):

```yaml
securityContext:
  fsGroup: 1000 # isti problem kao Docker chown iznad, rešen K8s-nativnim mehanizmom
env:
  - name: KAFKA_LOG_DIRS
    value: /var/lib/kafka/data # bez ovoga Kafka piše u /tmp i gubi SVE pri restartu pod-a
volumeClaimTemplates:
  - metadata: { name: kafka-data }
    spec:
      { storageClassName: standard, resources: { requests: { storage: 2Gi } } }
```

I [infra/k8s/kafka/topics-init-job.yaml](infra/k8s/kafka/topics-init-job.yaml) — jednokratan
`Job` (za razliku od Deployment-a koji radi zauvek, Job se pokrene, uradi posao jednom, i
završi) koji napravi Kafka temu sa 6 particija PRE nego što bilo koji worker krene da sluša
(ista `UNKNOWN_TOPIC_OR_PARTITION` zaštita kao u Docker Compose-u, sekcija 11.2).

**Zašto baš 6 particija?** Particija je kako se Kafka tema interno deli na komade koji mogu
da se obrađuju paralelno. Sa 1 particijom, čak i da imaš 10 kopija email-worker-a, samo JEDNA
od njih ikad može da čita tu temu u isto vreme (particija = jedinica paralelizma). Sa 6
particija, do 6 kopija worker-a mogu da rade istovremeno, svaka na svom komadu poruka. Ovo je
pripremljeno unapred za buduću fazu projekta — **KEDA** (Kubernetes Event-Driven
Autoscaling), koji bi automatski povećavao broj kopija worker-a kad se nagomila puno poruka
na čekanju, a to ima smisla samo ako particija ima dovoljno da se zaista radi paralelno.

---

## 14. Helm chart — `infra/helm/notification-platform/`

Helm je "upravljač paketima" za Kubernetes — zamisli ga kao `npm` ili `apt`, ali za K8s
konfiguraciju. Umesto da ručno kuckaš 15 YAML fajlova i u svakom ručno menjaš broj kopija ili
verziju slike, napraviš **šablone** (templates) sa promenljivama, i sve vrednosti držiš na
jednom mestu — [values.yaml](infra/helm/notification-platform/values.yaml).

### 14.1. `Chart.yaml` — "lična karta" paketa

```yaml
apiVersion: v2
name: notification-platform
version: 0.1.0
appVersion: '1.0.0'
```

### 14.2. `values.yaml` — SVE podesive vrednosti na jednom mestu

```yaml
kafka:
  replicas: 1
  storage:
    size: 2Gi
    storageClass: standard
  topic:
    name: notification.requested
    partitions: 6
```

Umesto da menjaš YAML fajlove direktno, menjaš samo ove brojeve/stringove ovde, i Helm ih
ubaci na pravo mesto u svim template-ima kad pokreneš `helm install`/`helm upgrade`.

### 14.3. `templates/_helpers.tpl` — pomoćne funkcije za ponavljajući kod

Ovo definiše male "funkcije" (`notification-platform.labels`, `notification-platform.fullname`
itd.) koje se pozivaju u svakom template fajlu pomoću `{{ include "notification-platform.labels" . | nindent 4 }}`,
da ne moraš da kucaš iste labele ručno u svih 14 fajlova.

### 14.4. Svaki template je "parametrizovana" verzija raw manifesta

Primer — [templates/retry-scheduler-deployment.yaml](infra/helm/notification-platform/templates/retry-scheduler-deployment.yaml)
vs. raw [infra/k8s/retry-scheduler/deployment.yaml](infra/k8s/retry-scheduler/deployment.yaml) —
ista stvar, samo umesto hardkodiranih brojeva (`replicas: 1`, `port: 3003`), piše
`{{ .Values.retryScheduler.replicas }}`, `{{ .Values.retryScheduler.port }}` — vrednost dolazi
iz `values.yaml`.

Bitan detalj koji je bio **bug, pronađen i ispravljen**: env promenljiva koja govori
aplikaciji na kom portu da sluša za health check mora da se zove TAČNO `HEALTH_PORT` (jer to
je ime koje čita kod u `main.ts`, sekcija 7/8/9 — `process.env.HEALTH_PORT ?? 3001`). U sva
tri worker Helm template-a (`email-worker-`, `webhook-worker-`, `retry-scheduler-deployment.yaml`)
je prvobitno pisalo `WORKER_PORT` — pogrešno ime, aplikacija ga nikad ne bi pročitala (samo bi
tiho pala na svoj hardkodirani default). Popravljeno na `HEALTH_PORT` u sva tri, i isti bug je
nađen i popravljen u raw manifestu `infra/k8s/webhook-worker/deployment.yaml`.

### 14.5. `templates/kafka-topics-init-job.yaml` — Helm verzija topic-init Job-a

Za razliku od raw manifesta, ovaj Job ima specijalne Helm "hook" anotacije:

```yaml
annotations:
  'helm.sh/hook': post-install,post-upgrade
  'helm.sh/hook-delete-policy': before-hook-creation,hook-succeeded
```

Ovo kaže Helm-u: "pokreni ovaj Job SVAKI PUT posle instalacije ILI nadogradnje" (ne samo
jednom) — pošto su Kubernetes Job-ovi nepromenljivi (immutable) kad se jednom kreiraju, Helm
mora prvo da obriše stari Job pre nego što napravi novi, svaki put kad uradiš `helm upgrade`.

### 14.6. Kako se sve ovo proverava (pošto Prettier ne može)

- `helm lint infra/helm/notification-platform` — proverava da li je Helm chart strukturno
  ispravan (nedostaju fajlovi, loš YAML indent, itd.)
- `helm template test infra/helm/notification-platform` — stvarno "renderuje" sve template-e
  sa pravim vrednostima iz `values.yaml`, da vidiš tačno kakav YAML bi stigao do klastera
- `kubectl apply --dry-run=client -f <renderovani-fajl>` — pita PRAVI Kubernetes API server
  "da li bi ovo prihvatio?", bez da stvarno nešto napravi u klasteru

---

## 15. Rezime — šta sistem radi kad pozoveš `POST /api/notifications`

1. Zahtev stigne gateway-u, prođe validaciju (`CreateNotificationDto`)
2. Proveri se rate limit u Redis-u (sekcija 6.3) — ako je prekoračen, `429`
3. Ako postoji `Idempotency-Key` header, proveri se Redis da li je ovo ponovljen zahtev
   (sekcija 6.2)
4. U JEDNOJ bazi transakciji: upiše se red u `Notification` (status `PENDING`) I red u
   `OutboxEvent` (sekcija 4) — ili oba uspeju, ili ni jedno
5. Gateway ODMAH odgovori korisniku (ne čeka Kafku!) — `{ id, status: "PENDING" }`
6. U pozadini, `OutboxRelayService` (sekcija 6.4) svake 2s pokupi čekajuće `OutboxEvent`
   redove i pošalje ih na Kafka temu `notification.requested`
7. Email-worker ILI webhook-worker (zavisno od `channel`) pokupi poruku sa Kafke (sekcija 7/8),
   pokuša da pošalje (mejl ili HTTP poziv), i ažurira status notifikacije na `DELIVERED` ili
   (za webhook) `RETRYING`/`FAILED`
8. Ako je `RETRYING`, retry-scheduler (sekcija 9) svake 2s proverava da li je vreme za novi
   pokušaj (`nextRetryAt <= sada`), i ako jeste, ponovo kreira `OutboxEvent` red — ciklus se
   ponavlja od koraka 6, dok notifikacija ne postane `DELIVERED` ili trajno `FAILED`

Kroz ceo ovaj tok, ništa se ne gubi čak i ako bilo koja komponenta (Kafka, worker, čak i sam
gateway) privremeno padne usred posla — svuda gde je to bitno, stanje je zapisano u Postgres
bazi PRE nego što se bilo šta pošalje dalje, tako da ponovno pokretanje uvek zna tačno gde je
stalo.

---

## 16. Šta je dalje na roadmap-i (nije još urađeno)

- **KEDA** (Kubernetes Event-Driven Autoscaling) — automatsko povećanje/smanjenje broja
  kopija email-worker/webhook-worker na osnovu toga koliko poruka čeka na Kafka temi. Zato je
  tema napravljena sa 6 particija unapred (sekcija 13) — bez dovoljno particija, dodatne
  kopije worker-a ne bi imale šta paralelno da rade.
- Uključivanje `lint`, `test`, `build`, `typecheck`, `e2e` u CI pipeline (trenutno
  zakomentarisano u [.github/workflows/ci.yml](.github/workflows/ci.yml), sekcija 12)

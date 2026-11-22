# KRANK

Tarayıcıda çalışan, dört zamanlı içten yanmalı motor simülatörü. Blok, piston, biyel, krank, eksantrik, supap ve turbo seçtiğin ölçülere göre prosedürel olarak kurulur. Arayüz Türkçedir. Kısa video çekmek için 9:16 kadrajı vardır.

## Çalıştırma

Node.js 20 veya daha yeni bir sürüm gerekir.

```bash
npm install
npm run dev
```

Geliştirme sunucusu [http://127.0.0.1:4731](http://127.0.0.1:4731) adresinde açılır.

Üretim derlemesi:

```bash
npm run build
npm run preview
```

`dist/` klasörü statik olarak herhangi bir sunucuya konabilir. Adresler görelidir.

Ses, tarayıcı kuralı nedeniyle ilk tıklamadan sonra başlar. WebGL destekleyen güncel bir masaüstü tarayıcı gerekir.

## Ne ayarlanır

- Yakıt: benzin veya dizel. Benzinde buji ve kıvılcım, dizelde enjektör, kızdırma bujisi ve sıkıştırma ile yanma vardır.
- Besleme: atmosferik veya turbo. Turboda türbin, boost ve ıslık devirle birlikte artar.
- Düzen: sıra 3, sıra 4, sıra 6, V6, V8. Ateşleme sırası krank geometrisiyle uyumludur.
- Çap, strok ve sıkıştırma. Hacim, tork ve güç bunlardan hesaplanır.
- Turbo hedef basıncı. Uzun süre 2 barın üstünde ve tam gazdaysa turbo arızası birikir.
- Hazır motorlar: 1.0 sıra-3 turbodan 6.7 V8 dizele kadar.

Devir ve gaz birbirinden bağımsızdır; bu bir dinamometre görünümüdür. Devir kaydırıcısı kırmızı bölgeyi geçerse aşırı devir sayacı dolar.

## Görünüm

- **Kapalı** motorun dışını gösterir.
- **Kesit** bloğu, kapağı ve karteri kaldırır; krank, biyel, piston, supap ve kam açıkta kalır.
- **Röntgen** gövdeyi yarı saydam yapar.
- **Patlat** parçaları birbirinden ayırır.
- **Etiketler** parça adlarını yazar. Parçanın üstüne gelince adı altta da belirir.
- **Döndür** kamerayı kendi kendine çevirir. ¾, yan, ön ve üst kadrajları da vardır.
- **Shorts 9:16** yan panelleri kapatır ve görüntüyü dikey kadraja alır. Devir, tork ve silindir durumları YouTube düğmelerinin üstünde kalacak şekilde durur.

## Telemetri

Devir, tork (Nm), güç (bg ve kW), hacim, turbo basıncı, yağ basıncı, hararet ve seçili silindirin krank açısına kilitli basınç grafiği gösterilir. Her silindirin zamanı (emme, sıkıştırma, ateşleme/yanma, egzoz) ayrı izlenir.

Sayılar öğretim amaçlı, tanıdık ölçekte bir BMEP modelidir. Dinamometre çıktısı değildir.

## Arızalar

Düğmeyle ya da zorlamayla tetiklenir. Sağ alttaki çubuklar dolunca ilgili arıza başlar.

| Arıza | Nasıl birikir | Ne olur |
| --- | --- | --- |
| Biyel kırılması | Kırmızı bölgede tam gaz, ya da yağ basıncı düşünce | Vuruntu, sonra biyel kopar, piston fırlar, motor kilitlenir |
| Conta yakma | Hararet yükselinçe | Beyaz duman, komşu silindirlerde tekleme, depoda kabarcık |
| Turbo arızası | Hedef basınç 2 barı aşıp tam gaz verilince | Islık bozulur, mavi duman, boost sıfırlanır |
| Triger kopması | Düğme | Kayış gider, supaplar açık kalır, piston supaba vurur |
| Hararet kilidi | Tıkalı radyatör veya conta sonrası sıcaklık | Devir düşer, motor sarar |

Yağ seviyesi kaydırıcısı ve **Radyatör tıkalı** anahtarı bu birikimi hızlandırır. **Sıfırla** motoru aynı ölçüyle temiz kurar.

## Kısayollar

`Boşluk` çalıştır veya durdur, `S` Shorts kadrajı, `C` kesit, `X` röntgen, `R` sıfırla. `1`–`5` arıza düğmeleridir.

## Ses

Web Audio ile üretilir. Ateşleme tıkları krank açısına kilitlenir; dizel daha kuru ve tiz, benzin daha yuvarlaktır. Turbo ıslığı basınca ve devire bağlıdır. Vuruntuda metalik tık, kopmada patlama duyulur. Sağ üstten kapatılabilir.

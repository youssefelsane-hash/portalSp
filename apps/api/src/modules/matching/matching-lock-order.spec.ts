import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * حارس **ترتيب القفل** (docs/08 §148).
 *
 * الفني مورد مشترك بين طلبات مختلفة، فالقاعدة إنه يتقفل قبل الطلب. مسار واحد بيعكس الترتيب
 * كفاية لعمل ABBA deadlock مع باقي المسارات — وده بالظبط اللي حصل: `accept()` كان بالترتيب
 * الصح و`acceptWorkOpportunity()`/`autoConfirmScheduledOrder()`/`acceptCrewOpportunity()`
 * بالعكس، فالفني كان بياخد ٥٠٠ «حصل خطأ غير متوقع» وهو بيدوس «اقبل».
 *
 * الاختبار ده بيقرا الكود نفسه: في أي transaction فيها **قفل فني وقفل طلب مع بعض**، لازم
 * `lockTechnician` تيجي قبل `setLock('pessimistic_write')` اللي على `Order`. مكتوب كفحص نصّي
 * عمدًا — إعادة إنتاج deadlock حقيقي في اختبار بتبقى غير حتمية، والقاعدة نفسها ثابتة وقابلة
 * للقراءة من الكود.
 */
describe('ترتيب القفل: الفني قبل الطلب (§148)', () => {
  const ROOT = path.resolve(__dirname, '../..');
  const FILES = [
    'modules/matching/matching.service.ts',
    'modules/orders/order-team.service.ts',
    'modules/orders/admin-orders.service.ts',
  ];

  /** بيقسّم الملف لكتل `transaction(async (manager) => { … })` تقريبية بالأقواس. */
  function transactionBlocks(source: string): string[] {
    const blocks: string[] = [];
    const marker = /\.transaction\(async \((?:\w+)\) => \{/g;
    let match: RegExpExecArray | null;
    while ((match = marker.exec(source)) !== null) {
      let depth = 1;
      let i = match.index + match[0].length;
      while (i < source.length && depth > 0) {
        if (source[i] === '{') depth += 1;
        else if (source[i] === '}') depth -= 1;
        i += 1;
      }
      blocks.push(source.slice(match.index, i));
    }
    return blocks;
  }

  for (const relative of FILES) {
    it(`${relative} — كل معاملة بتقفل الاتنين بتبدأ بالفني`, () => {
      const source = fs.readFileSync(path.join(ROOT, relative), 'utf8');
      for (const block of transactionBlocks(source)) {
        const technicianAt = block.indexOf('lockTechnician');
        const orderLock = /createQueryBuilder\(Order, '\w+'\)\s*\n?\s*\.setLock\('pessimistic_write'\)/.exec(block);
        if (technicianAt === -1 || !orderLock) continue;
        expect(technicianAt).toBeLessThan(orderLock.index);
      }
    });
  }

  it('الفحص نفسه له معنى — بيلاقي معاملات فيها القفلين فعلاً', () => {
    const source = fs.readFileSync(path.join(ROOT, 'modules/matching/matching.service.ts'), 'utf8');
    const withBoth = transactionBlocks(source).filter(
      (block) => block.includes('lockTechnician') && block.includes("setLock('pessimistic_write')"),
    );
    expect(withBoth.length).toBeGreaterThanOrEqual(2);
  });
});

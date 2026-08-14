import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type CrossReferenceCodeDocument = HydratedDocument<CrossReferenceCodeModel>;

// One row per (brand, code) pair, member of a CrossReferenceGroupModel. Split out
// from the group itself (which used to embed these as an array) so uniqueness of
// (brand, codeKey) -> group can be enforced by a real Mongo index — an array of
// subdocuments cannot carry that constraint across different parent documents.
@Schema({ collection: 'cross_reference_codes', timestamps: true })
export class CrossReferenceCodeModel {
    _id: Types.ObjectId;

    @Prop({ type: Types.ObjectId, ref: 'CrossReferenceGroupModel', required: true, index: true })
    groupId: Types.ObjectId;

    // Brand as received from the source (catalog/manual entry) — preserved for
    // display/auditing.
    @Prop({ required: true })
    brand: string;

    // brand.trim().toUpperCase() — what every match/uniqueness check actually
    // compares against. Different catalogs spell the same brand with
    // different casing (e.g. ZF Aftermarket's "TRW" vs Cofap's "Trw") — verified
    // 212 such pairs across the current catalog set. Without this, the exact-
    // match unique index on `brand` silently splits what should be one
    // cross-reference group into two, one per spelling.
    @Prop({ required: true })
    brandKey: string;

    // Code as received from the source (catalog/manual entry) — preserved for
    // display/auditing.
    @Prop({ required: true })
    raw: string;

    // normalizeCode(raw) — see utils/code-key.util. This is what every match/search
    // actually compares against.
    @Prop({ required: true })
    codeKey: string;

    // Set when this row's brand is a known ghost brand (e.g. "SIMILAR",
    // "DIVERSOS" — a source catalog citing an equivalent without naming its
    // real manufacturer) AND another row in the same group carries the same
    // codeKey under a real, named brand. Never set by the live ingestion
    // path (processCrossReferences) — only by the migration backfill, which
    // is the point where this class of legacy noise becomes visible across
    // the whole dataset at once. See design doc section 4.1/5.1.
    @Prop({ type: Boolean, default: false, index: true })
    flaggedAsGhostBrand?: boolean;

    // _id of the CrossReferenceCodeModel row (same group, real brand) this
    // one duplicates. Only meaningful when flaggedAsGhostBrand is true.
    @Prop({ type: Types.ObjectId })
    ghostBrandDuplicateOf?: Types.ObjectId;

    // Membership role within a 'kit' group (see CrossReferenceGroupModel.groupType).
    // Undefined/irrelevant for 'equivalence' groups. A 'kit' group has exactly one
    // 'kit' row (the complete assembly) and one or more 'component' rows (the
    // parts it's made of, sold separately).
    @Prop({ type: String, enum: ['kit', 'component'] })
    role?: 'kit' | 'component';
}

export const CrossReferenceCodeSchema = SchemaFactory.createForClass(CrossReferenceCodeModel);

// The constraint this collection exists for: a given brand's code (normalized)
// can only ever belong to one group at a time. Keyed on brandKey/codeKey (both
// normalized), not the raw brand/raw strings, so casing differences across
// catalogs can't split one physical cross-reference into two groups.
CrossReferenceCodeSchema.index({ brandKey: 1, codeKey: 1 }, { unique: true });

// The admin conflicts search (CrossReferenceService.listConflicts `search`
// param) uses a separate Atlas Search / mongot autocomplete index named
// "cross_reference_codes_search" on {brand, raw} instead of a regular Mongo
// index — at this collection's scale (827k+ docs), a substring match
// ("contains anywhere", not just a prefix) isn't something a b-tree index
// can serve; mongot's nGram-based autocomplete tokenizer is what makes that
// fast. That search index is created via mongosh
// (db.cross_reference_codes.createSearchIndex(...)), not declared here —
// Mongoose/Mongo has no schema-level API for search indexes.

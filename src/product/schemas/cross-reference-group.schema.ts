import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type CrossReferenceGroupDocument = HydratedDocument<CrossReferenceGroupModel>;

// A group represents a set of manufacturer-brand/code pairs that are interchangeable
// equivalents of one physical part (OEM/competitor cross-references). Membership
// (the actual codes) lives in CrossReferenceCodeModel, keyed by groupId — this
// document is metadata only.
@Schema({ collection: 'cross_reference_groups', timestamps: true })
export class CrossReferenceGroupModel {
    _id: string;

    // 'conflict': a code arriving via processCrossReferences was already claimed
    // (brand+codeKey) by a different group under circumstances that look like a
    // genuine collision (see CrossReferenceService). The merge still happens
    // (never blocks import) — this only flags the group for manual review via
    // GET /cross-references/conflicts.
    @Prop({ type: String, enum: ['active', 'conflict'], default: 'active', index: true })
    status: 'active' | 'conflict';

    @Prop({ type: String })
    conflictReason?: string;

    @Prop({ type: Date })
    conflictAt?: Date;

    // 'equivalence' (default): interchangeable OEM/competitor codes for the SAME
    // physical part (existing behavior, see class doc above). 'kit': a complete
    // assembly (e.g. a full alternator) and the DIFFERENT products that are its
    // separately-sellable components (e.g. pulley, voltage regulator) — see
    // docs/superpowers/specs/2026-07-24-kit-component-relations-design.md.
    // Membership role for 'kit' groups lives on CrossReferenceCodeModel.role.
    // Kit groups never reach 'conflict': they don't compete for a {brandKey,
    // codeKey} claim in the equivalence sense, so they're created 'active' and
    // stay that way.
    @Prop({ type: String, enum: ['equivalence', 'kit'], default: 'equivalence', index: true })
    groupType: 'equivalence' | 'kit';
}

export const CrossReferenceGroupSchema = SchemaFactory.createForClass(CrossReferenceGroupModel);

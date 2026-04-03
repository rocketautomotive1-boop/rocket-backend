import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { QuestionModel, QuestionDocument } from './schemas/question.schema';

@Injectable()
export class QuestionRepository {
    constructor(
        @InjectModel(QuestionModel.name) private questionModel: Model<QuestionDocument>
    ) { }

    async findById(id: string): Promise<QuestionDocument | null> {
        return this.questionModel.findById(id).exec();
    }

    async findAll(query: any = {}, options: any = {}): Promise<QuestionDocument[]> {
        const { limit = 50, offset = 0, sort = { dateCreated: -1 } } = options;
        return this.questionModel.find(query)
            .sort(sort)
            .skip(offset)
            .limit(limit)
            .populate('product')
            .exec();
    }

    async findOne(query: any): Promise<QuestionDocument | null> {
        return this.questionModel.findOne(query).exec();
    }

    async create(data: any): Promise<QuestionDocument> {
        const question = new this.questionModel(data);
        return question.save();
    }

    async update(id: string, data: any): Promise<QuestionDocument | null> {
        return this.questionModel.findByIdAndUpdate(id, data, { new: true }).exec();
    }

    async delete(id: string): Promise<void> {
        await this.questionModel.deleteOne({ _id: id }).exec();
    }

    async count(query: any = {}): Promise<number> {
        return this.questionModel.countDocuments(query).exec();
    }

    async findByIdWithProduct(id: string): Promise<QuestionDocument | null> {
        return this.questionModel.findById(id).populate('product').exec();
    }

    async aggregate(pipeline: any[]): Promise<any[]> {
        return this.questionModel.aggregate(pipeline).exec();
    }
}

import { Model, ClientSession } from "mongoose";
import { RequestContextService } from "../context/request-context";
import { Entity } from "../ddd/entity.base";

export interface Mapper<TEntity extends Entity<object>, TDoc = any> {
  toDomain(doc: TDoc): TEntity;
  toPersistence(entity: TEntity): Record<string, unknown>;
}

export interface PaginationParams {
  limit: number;
  page: number;
}

export interface PaginatedResult<TEntity> {
  data: TEntity[];
  count: number;
  limit: number;
  page: number;
}

export class MongooseRepositoryBase<TEntity extends Entity<object>, TDoc = any> {
  protected model: Model<TDoc>;

  protected mapper: Mapper<TEntity, TDoc>;

  constructor(model: Model<TDoc>, mapper: Mapper<TEntity, TDoc>) {
    this.model = model;
    this.mapper = mapper;
  }

  // eslint-disable-next-line class-methods-use-this
  protected get session(): ClientSession | undefined {
    return RequestContextService.getTransactionSession() as ClientSession | undefined;
  }

  async findOneById(id: string): Promise<TEntity | null> {
    const doc = await this.model
      .findOne({ _id: id, isDeleted: false })
      .session(this.session ?? null)
      .lean();
    return doc ? this.mapper.toDomain(doc as TDoc) : null;
  }

  async findAll(): Promise<TEntity[]> {
    const docs = await this.model
      .find({ isDeleted: false })
      .session(this.session ?? null)
      .lean();
    return docs.map((doc) => this.mapper.toDomain(doc as TDoc));
  }

  async findAllPaginated({ limit, page }: PaginationParams): Promise<PaginatedResult<TEntity>> {
    const filter = { isDeleted: false };
    const [docs, count] = await Promise.all([
      this.model
        .find(filter)
        .session(this.session ?? null)
        .skip(page * limit)
        .limit(limit)
        .lean(),
      this.model.countDocuments(filter).session(this.session ?? null)
    ]);

    return {
      data: docs.map((doc) => this.mapper.toDomain(doc as TDoc)),
      count,
      limit,
      page
    };
  }

  async insert(entity: TEntity): Promise<void> {
    entity.validate();
    const record = this.mapper.toPersistence(entity);
    await this.model.create([record], { session: this.session ?? null });
  }

  async updateById(id: string, entity: TEntity): Promise<TEntity | null> {
    entity.validate();
    const record = this.mapper.toPersistence(entity);
    const doc = await this.model
      .findOneAndUpdate({ _id: id, isDeleted: false }, record, {
        session: this.session ?? null,
        new: true
      })
      .lean();
    return doc ? this.mapper.toDomain(doc as TDoc) : null;
  }

  async delete(entity: TEntity): Promise<boolean> {
    const result = await this.model.updateOne(
      { _id: entity.id, isDeleted: false },
      { isDeleted: true },
      { session: this.session }
    );
    return result.modifiedCount > 0;
  }
}

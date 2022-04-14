import { makeExecutableSchema } from "@graphql-tools/schema";
import { GraphQLContext } from "./context";
import typeDefs from "../src/schema.graphql";
import { Link, Customer , Prisma } from "@prisma/client"; 
import { APP_SECRET } from "./auth";
import { hash, compare } from "bcryptjs";
import { sign } from "jsonwebtoken";
import { PubSubChannels } from "./pubsub";

const resolvers = {
    Query: {
        info: () => 'This is the API of a Hackernews clone',
        feed: async (
            parent: unknown, 
            args: { 
                filter?: string, 
                skip?: number, 
                take?: number,
                orderBy?: {
                    description?: Prisma.SortOrder;
                    url?: Prisma.SortOrder;
                    createdAt?: Prisma.SortOrder;
                };
            }, 
            context: GraphQLContext
            ) => {
                const where = args.filter ?
                {
                    OR: [
                        { description: { contains: args.filter }},
                        { url: { contains: args.filter }},
                    ],
                } : {};

                const totalCount = await context.prisma.link.count({ where });
                const links = await context.prisma.link.findMany({
                    where,
                    skip: args.skip,
                    take: args.take,
                    orderBy: args.orderBy,
                });

                return {
                    count: totalCount,
                    links,
                };
        },
        me: (parent: unknown, args: {}, context: GraphQLContext) => {
            if (context.currentCustomer === null) {
                throw new Error("Unauthenticated!");
            }
            return context.currentCustomer;
        }
    },

    Link: {
        id: (parent: Link) => parent.id,
        description: (parent: Link) => parent.description,
        url: (parent: Link) => parent.url,
        postedBy: async ( parent: Link, args: {}, context: GraphQLContext) => {
            if (!parent.postedById) {
                return null;
            }
            return context.prisma.link.findUnique({ where: { id: parent.id }}).postedBy();
        },
        votes: (parent: Link, args: {}, context: GraphQLContext) => 
            context.prisma.link.findUnique({ where: { id: parent.id }}).votes(),
    },

    Customer: {
        links: (parent: Customer, args: {}, context: GraphQLContext) => 
            context.prisma.customer.findUnique({ where: { id: parent.id }}).links(),
    },

    Vote: {
        link: (parent: Customer, args: {}, context: GraphQLContext) =>
          context.prisma.vote.findUnique({ where: { id: parent.id } }).link(),
        customer: (parent: Customer, args: {}, context: GraphQLContext) =>
          context.prisma.vote.findUnique({ where: { id: parent.id } }).customer(),
    },

    Mutation: {
        signup: async (
            parent: unknown,
            args: { email: string, password: string, name: string },    
            context: GraphQLContext 
        ) => {
            const password = await hash(args.password, 10);
            const customer = await context.prisma.customer.create({
                data: { ...args, password },
            });
            const token = sign({ customerId: customer.id }, APP_SECRET);
            return {
                token,
                customer,
            }
        },
        
        login: async (
            parent: unknown,
            args: { email: string, password: string },
            context: GraphQLContext
        ) => {
            const customer = await context.prisma.customer.findUnique({
                where: { email: args.email },
            });
            if (!customer) {
                throw new Error("No such customer found");
            }

            const valid = await compare(args.password, customer.password);
            if (!valid) {
                throw new Error("Password doesn't match");
            }    

            const token = sign({ customerId: customer.id }, APP_SECRET);

            return {
                token,
                customer,
            };
        },

        post: async (
            parent: unknown, 
            args: { description: string, url: string },
            context: GraphQLContext
        ) => {
            if (context.currentCustomer === null) {
                throw new Error("Unauthenticated");
            }
            const newLink = await context.prisma.link.create({
                data: {
                    url: args.url,
                    description: args.description,
                    postedBy: { connect: { id: context.currentCustomer.id }},
                },
            });

            context.pubSub.publish("newLink", { createdLink: newLink });

            return newLink;
        },

        vote: async (
            parent: unknown,
            args: { linkId: string },
            context: GraphQLContext
        ) => {
            if (!context.currentCustomer) {
              throw new Error("You must login in order to use upvote!");
            }

            const customerId = context.currentCustomer.id;
      
            const vote = await context.prisma.vote.findUnique({
              where: {
                linkId_customerId: {
                  linkId: Number(args.linkId),
                  customerId: customerId,
                },
              },
            });
      
            if (vote !== null) {
              throw new Error(`Already voted for link: ${args.linkId}`);
            }
      
            const newVote = await context.prisma.vote.create({
              data: {
                customer: { connect: { id: customerId } },
                link: { connect: { id: Number(args.linkId) } },
              },
            });
      
            context.pubSub.publish("newVote", { createdVote: newVote });
      
            return newVote;
        },
    },

    Subscription: {
        newLink: {
            subscribe: (parent: unknown, args: {}, context: GraphQLContext) => {
                return context.pubSub.asyncIterator("newLink");
            },
            resolve: (payload: PubSubChannels["newLink"][0]) => {
                return payload.createdLink;
            },
        },

        newVote: {
            subscribe: (parent: unknown, args: {}, context: GraphQLContext) => {
              return context.pubSub.asyncIterator("newVote");
            },
            resolve: (payload: PubSubChannels["newVote"][0]) => {
              return payload.createdVote;
            },
        },
    },
}

export const schema = makeExecutableSchema({
    typeDefs,
    resolvers,
})
tscheem = (function () {
    var parseScheem;

    if (typeof module !== 'undefined') {
        var PEG = require('pegjs');
        var fs = require('fs');

        try {
            parseScheem = PEG.buildParser(fs.readFileSync('tscheem.peg', 'utf-8')).parse;
        }
        catch (e) {
            parseScheem = PEG.buildParser(fs.readFileSync('../tscheem.peg', 'utf-8')).parse;
        }
    }
    else {
        parseScheem = tscheemParser.parse;
    };

    var eval = function (string, env) {
        return evalScheem(parseScheem(string));
    };

    var evalScheem = function (expr, env) {
        var outerEnv = { bindings: builtinFunctions, outer: null };
		var hasOwnProperty = Object.prototype.hasOwnProperty;
		var tEnv = { bindings: { }, outer: outerEnv };
		var eEnv = { bindings: { }, outer: outerEnv };

		// Add type information
		if (env && env.bindings) {
			if (env.outer) throw('Only single level environments allowed');

			var bindings = env.bindings;
			var tBindings = tEnv.bindings;
			var eBindings = eEnv.bindings;
			
			for (var k in bindings) {
				if (hasOwnProperty.call(bindings, k)) {
					var v = bindings[k];
					var t = typeExpr(v, null);
					
					tBindings[k] = { v: v, t: t };
					eBindings[k] = { v: v, t: t };
				}
			}
		}
		
		if (!typeExpr(expr, tEnv)) throw ('Type mismatch');

        var ret = _evalScheem(expr, eEnv);

		if (typeof ret === 'function') throw('Incomplete function evaluation');
		
		// Remove type information
		if (env && env.bindings) {
			var newBindings = { };
			
			bindings = eEnv.bindings;
			
			for (var k in bindings) {
				if (hasOwnProperty.call(bindings, k)) {
					newBindings[k] = bindings[k].v;
				}
			}
			env.bindings = newBindings;
		};
		
		return ret;
    };

    var arraySlice = (function (/* array, from, to */) {
        var f = Array.prototype.slice;

        return function (array, from, to) {
            return f.call(array, from, to);
        };
    })();

    var isArray = function (obj) {
        return obj && obj instanceof Array;
    };

    var isList = function (obj) {
        return obj && (obj instanceof Array || obj === '#nil');
    };

    var isBool = function (obj) {
        return obj && (obj === '#t' || obj === '#f');
    };

	var isAtom = function (obj) {
		return obj && typeof obj === 'string' && !isBool(obj) && obj !== '#nil' && parseInt(obj) !== +obj;
	};
	
    var checkNumber = function (obj) {
        if (typeof obj !== 'number') throw('Invalid number: ' + obj);
        return obj;
    };

    var checkAtom = function (obj) {
        if (!isAtom(obj)) throw('Invalid symbol: ' + obj);
        return obj;
    };

    var checkTypeExpr = function (obj) {
        if (typeof obj !== 'object' || !obj.tag) throw('Invalid type expression: ' + obj);
        return obj;
    };

    var checkList = function (obj) {
        if (!isList(obj)) throw('Invalid list: ' + obj);
        return obj;
    };

    var checkBool = function (obj) {
        if (!isBool(obj)) throw('Invalid bool: ' + obj);
        return obj;
    };

    var toScheemBool = function (arg) {
        return arg ? '#t' : '#f';
    };

    var lookupBinding = function (env, v) {
        if (!env) throw('Variable not defined: ' + v);
        return v in env.bindings ? env.bindings[v] : lookupBinding(env.outer, v);
    };

    var updateBinding = function (env, v, val) {
        if (!env) throw('Symbol not defined: ' + v);
        if (v in env.bindings) {
            var b = env.bindings[v];

            if (!sameType(b.t, typeExpr(val, env))) throw('Type mismatch');
            return b.v = val;
        }
        return updateBinding(env.outer, v, val);
    };

    var addBinding = function (env, v, type, val) {
        if (v in env.bindings) throw('Symbol already defined: ' + v);
        return env.bindings[v] = { v: val, t: type };
    };

    var sameType = function (a, b) {
        if (a.tag === 'any' || b.tag === 'any') return true;
        if (a.tag !== b.tag) return false;
        switch (a.tag) {
            case 'base':
                return a.name === b.name;

            case 'arrow':
                return sameType(a.left, b.left) && sameType(a.right, b.right);
        }
        throw('Unhandled type: ' + a.tag);
    };

    var typeExpr = (function (/* expr, env */) {
        var typeExprDefine = function (expr, env) {
            var type;

            switch (expr.length) {
                case 3:
                    try {
                        type = typeExpr(expr[2], env);
                    }
                    catch (ex) {
                        throw('Cannot deduce type');
                    }
                    addBinding(env, expr[1], type);
                    break;

                case 4:
                    addBinding(env, expr[1], expr[2]);
                    if (!sameType(type = checkTypeExpr(expr[2]), typeExpr(expr[3], env))) throw('Type mismatch');
                    break;

                default:
                    throw('Malformed define expression');
            }
            return type;
        };

        var typeExprSet = function (expr, env) {
            if (expr.length != 3) throw('Malformed set! expression');

            var type = typeExpr(expr[1], env);

            if (!(sameType(type, typeExpr(expr[2], env)))) throw('Type mismatch');
            return type;
        };

        var typeExprBegin = function (expr, env) {
            var type = unitType;
			var len = expr.length;

			for (var i = 1; i < len; ++i) {
				type = typeExpr(expr[i], env);
			}
			return type;
        };

        var typeExprQuote = function (expr, env) {
            if (expr.length != 2) throw('Malformed quote expression');

            expr = expr[1];
            switch (typeof expr) {
                case 'number':
                    return numType;

                case 'string':
                    if (expr === '#t' || expr === '#f') return boolType;
                    if (expr === '#nil') return listType;
                    return atomType;
            }

            if (!isArray(expr)) throw('Unexpected expression type for quote');
            return listType;
        };

        var typeExprIf = function (expr, env) {
            if (expr.length != 4) throw('Malformed if expression');

            var condType = typeExpr(expr[1], env);

            if (condType.tag != 'base' || condType.name !== 'boolean') throw('Wrong condition type');

            var leftType = typeExpr(expr[2], env);
            var rightType = typeExpr(expr[3], env);

            if (!(sameType(leftType, rightType))) throw('Type mismatch');
            return leftType;
        };

        var typeExprLambdaOne = function(expr, env) {
            var newEnv = { bindings: {}, outer: env };
            var body, type;

            switch (expr.length) {
                case 3:
                    body = expr[2];
                    try {
                        type = typeExpr(body, env);
                    }
                    catch (ex) {
                        throw('Cannot deduce type');
                    }
                    break;

                case 4:
                    body = expr[3];
                    type = checkTypeExpr(expr[2]);
                    break;

                default:
                    throw('Malformed lambda-one expression');
            }
            newEnv.bindings[expr[1]] = { t: type };
            return arrow(expr[2], typeExpr(body, newEnv));
        };

        var typeExprLambda = function (expr, env) {
            if (expr.length != 3) throw('Malformed lambda expression');

            var args = checkList(expr[1]);
            var body = expr[2];
            var dummyType = { };

            if (args === '#nil') args = [];

            var len = args.length;
            var type = arrow(unitType, dummyType);
            var branch = type;

			if (len & 1) throw('Invalid arguments for lambda');
            for (var i = 0; i < len; i += 2) {
                var argName = checkAtom(args[i]);
                var argType = checkTypeExpr(args[i + 1]);

                env = { bindings: { }, outer: env };
                env.bindings[argName] = { t: argType };
                if (i > 0) {
                    branch.right = arrow(dummyType, dummyType);
                    branch = branch.right;
                }
                branch.left = argType;
            }
            branch.right = typeExpr(body, env);
            return type;
        };

        var typeExprApply = function (expr, env) {
            var f = expr[0];
            var tf = typeExpr(f, env);
			var args = expr.slice(1);
			var len = args.length;
			var tl, tr;
			
			if (!len && tf.left === unitType) {
				if (tf.tag !== 'arrow') throw('Not an arrow type');
				tr = tf.right;
			}
			for (var i = 0; i < len; ++i) {
				if (tf.tag !== 'arrow') throw('Not an arrow type');
				tl = tf.left;
				tr = tf.right;

				var ta = typeExpr(args[i], env);
				
				if (!(sameType(tl, ta, env))) throw('Argument type mismatch');
				tf = tr;
			}
            return tr;
        };

        return function (expr, env) {
            switch (typeof expr) {
                case 'number':
                    return numType;

                case 'string':
                    if (expr === '#t' || expr === '#f') return boolType;
                    if (expr === '#nil') return listType;
                    return lookupBinding(env, expr).t;

                case 'function':
                    return arrow(anyType, anyType);
            }

            if (!isArray(expr)) throw('Unexpected expression type');

            switch (expr[0]) {
                case 'define': return typeExprDefine(expr, env);
                case 'set!': return typeExprSet(expr, env);
                case 'begin': return typeExprBegin(expr, env);
                case 'quote': return typeExprQuote(expr, env);
                case 'if': return typeExprIf(expr, env);
                case 'lambda-one': return typeExprLambdaOne(expr, env);
                case 'lambda': return typeExprLambda(expr, env);
            };
            return typeExprApply(expr, env)
        };
    })();

    // Type definitions & functions

    var base = function (t) { return { tag: 'base', name: t }; }
    var arrow = function (l, r) {
        if (arguments.length == 2) return { tag: 'arrow', left: l, right: r };
        return { tag: 'arrow', left: l, right: arrow.apply(null, arraySlice(arguments, 1)) };
    };
    var numType = base('number');
    var boolType = base('boolean');
    var atomType = base('atom');
    var listType = base('list');
    var unitType = base('unit');
    var anyType = { tag: 'any' };

    var curry2 = function (f) {
        return function (l) {
            return function (r) {
                return f(l, r);
            };
        };
    };

    var builtinFunctions = (function () {
        var bindings = { };

        var addUnOp = function (name, type, f) {
            bindings[name] = { v: f, t: type };
        }

        var addBinOp = function (name, type, f) {
            bindings[name] = { v: curry2(f), t: type };
        }

        var eq = function (l, r) {
            return isList(l) ? isList(r) && listEq(l, r) : l === r;
        };

        var listEq = function (l, r) {
            var len = isArray(l) ? l.length : 0;

            if (len !== (isArray(r) ? r.length : 0)) return false;
            for (var i = 0; i < len; ++i) {
                var x = l[i];
                var y = r[i];

                if (isList(x)) {
                    if (!(isList(y) && listEq(x, y))) return false;
                }
                if (x !== y) return false;
            }
            return true;
        };

        addUnOp('unm', arrow(numType, numType), function (n) { return -n; });
        addUnOp('not', arrow(boolType, boolType), function (a) { return toScheemBool(a === '#f'); });
        addUnOp('car', arrow(listType, anyType), function (l) { if (!l.length) throw('First argument must be an non-empty list'); return l[0]; });
        addUnOp('cdr', arrow(listType, listType), function (l) { if (!l.length) throw('First argument must be an non-empty list'); return l.slice(1); });
        addUnOp('empty?', arrow(listType, boolType), function (l) { return toScheemBool(isList(l) && listEq(l, '#nil')); });
        addUnOp('zero?', arrow(numType, boolType), function (n) { return toScheemBool(n === 0); });
        addUnOp('list?', arrow(anyType, boolType), function (a) { return toScheemBool(isList(a)); });
        addUnOp('atom?', arrow(anyType, boolType), function (a) { return toScheemBool(isAtom(a)); });
        addUnOp('number?', arrow(anyType, boolType), function (a) { return toScheemBool(typeof a == 'number'); });
        addUnOp('boolean?', arrow(anyType, boolType), function (a) { return toScheemBool(isBool(a)); });
        addUnOp('alert', arrow(anyType, anyType), function (e) { alert(e); return e; });

        addBinOp('+', arrow(numType, numType, numType), function (l, r) { return l + r; });
        addBinOp('-', arrow(numType, numType, numType), function (l, r) { return l - r; });
        addBinOp('*', arrow(numType, numType, numType), function (l, r) { return l * r; });
        addBinOp('/', arrow(numType, numType, numType), function (l, r) { if (r === 0) throw('Division by zero'); return l / r; });
        addBinOp('%', arrow(numType, numType, numType), function (l, r) { if (r === 0) throw('Division by zero'); return l % r; });
        addBinOp('=', arrow(anyType, anyType, boolType), function (l, r) { return toScheemBool(eq(l, r)); });
        addBinOp('<>', arrow(anyType, anyType, boolType), function (l, r) { return toScheemBool(!eq(l, r)); });
        addBinOp('<', arrow(numType, numType, numType), function (l, r) { return toScheemBool(l < r); });
        addBinOp('>', arrow(numType, numType, numType), function (l, r) { return toScheemBool(l > r); });
        addBinOp('<=', arrow(numType, numType, numType), function (l, r) { return toScheemBool(l <= r); });
        addBinOp('>=', arrow(numType, numType, numType), function (l, r) { return toScheemBool(l >= r); });
        addBinOp('and', arrow(boolType, boolType, boolType), function (l, r) { return toScheemBool(l === '#t' && r === '#t'); });
        addBinOp('or', arrow(boolType, boolType, boolType), function (l, r) { return toScheemBool(l === '#t'  || r === '#t'); });
        addBinOp('cons', arrow(anyType, listType, listType), function (e, l) { return [e].concat(l === '#nil' ? [] : l); });

        return bindings;
    })();

    var _evalScheem = function (expr, env) {
        // True, False, Nil
        if (expr === '#t' || expr === '#f' || expr === '#nil') return expr;

        // Numbers and functions evaluate to themselves
        if (typeof expr === 'number' || typeof expr === 'function') return expr;

        // Strings are variable references
        if (typeof expr === 'string') return lookupBinding(env, expr).v;

        var len = expr.length,
            tmp, tmp2, tmp3, i;

        // Look at head of list for operation
        switch (expr[0]) {
            case 'define':
                if (len < 3 || len > 4) throw('Malformed lambda-one expression');
                tmp = checkAtom(expr[1]);
                tmp3 = _evalScheem(len == 3 ? expr[2] : expr[3], env);
                tmp2 = len == 3 ? typeExpr(tmp3, env) : checkTypeExpr(expr[2]);
                addBinding(env, tmp, tmp2, tmp3);
                return tmp3;

            case 'set!':
                if (len != 3) throw('Malformed set! expression');
                tmp = checkAtom(expr[1]);
                return updateBinding(env, tmp, _evalScheem(expr[2], env));

            case 'begin':
                tmp = '#nil';
                for (i = 1; i < len; ++i) tmp = _evalScheem(expr[i], env);
                return tmp;

            case 'quote':
                if (len != 2) throw('Malformed quote expression');
                return expr[1];

            case 'if':
                if (len != 4) throw('Malformed if expression');
                return _evalScheem(expr[1], env) === '#t' ? _evalScheem(expr[2], env) : _evalScheem(expr[3], env);

            case 'lambda-one':
                if (len < 3 || len > 4) throw('Malformed lambda-one expression');
                tmp = checkAtom(expr[1]);
                tmp2 = len == 3 ? expr[2] : expr[3];
                if (len == 4) checkTypeExpr(expr[2]);

                return function (arg) {
                    var newEnv = {
                        outer: env,
                        bindings: { }
                    };

                    newEnv.bindings[tmp] = { t: typeExpr(arg, env), v: arg };
                    return _evalScheem(tmp2, newEnv);
                };

            case 'lambda':
                if (len != 3) throw('Malformed lambda expression');
				
				if ((tmp = checkList(expr[1])) === '#nil') tmp = [];
				tmp2 = tmp.length;
                if (tmp2 & 1) throw('Invalid arguments for lambda');
				for (i = 0; i < tmp2; i += 2) {
					checkAtom(tmp[i]);
					checkTypeExpr(tmp[i + 1]);
				}
				
                if (tmp2) {
                    i = 0;
                    tmp2 -= 2;

                    return tmp3 = function (arg) {
                        env = { outer: env, bindings: { } };
                        env.bindings[tmp[i]] = { t: typeExpr(arg, env), v: arg };
                        return i === tmp2 ? _evalScheem(expr[2], env) : (i += 2, tmp3);
                    };
                }
                else {
                    return function () { return _evalScheem(expr[2], env); };
                }

            default:
                tmp = _evalScheem(expr[0], env);
				if (len === 1) {
					if (typeof tmp !== 'function') throw('Invalid expression');
					if (sameType(typeExpr(expr, env), unitType)) throw('Incomplete function application');
					tmp = tmp();
				}
				else {
					for (i = 1; i < len; ++i) {
						if (typeof tmp !== 'function') throw('Invalid expression');
						tmp = tmp(_evalScheem(expr[i], env));
					}
				}
                return tmp;
        }
    };

    return {
        eval: eval,
        evalScheem: evalScheem
    }
})();

// If we are used as Node module, export _evalScheem
if (typeof module !== 'undefined') {
    module.exports.eval = scheem.eval;
    module.exports.evalScheem = scheem.evalScheem;
}